"""Importação de jogos instalados por outras lojas: GOG, Ubisoft Connect, EA app, Battle.net e Xbox (Game Pass)."""
import hashlib
import logging
import os
import re
import string
import xml.etree.ElementTree as ET
from pathlib import Path

try:
    import winreg
except ImportError:  # pragma: no cover
    winreg = None

from .scanner import detect_game
from .sfo import clean_title

log = logging.getLogger("gamevault.stores")

UNINSTALL_KEYS = (
    (r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM"),
    (r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM"),
    (r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", "HKCU"),
)


# --- registro -----------------------------------------------------------------
def _hive(name):
    return winreg.HKEY_LOCAL_MACHINE if name == "HKLM" else winreg.HKEY_CURRENT_USER


def _subkeys(hive, path):
    if not winreg:
        return
    try:
        with winreg.OpenKey(hive, path) as k:
            i = 0
            while True:
                try:
                    yield winreg.EnumKey(k, i)
                except OSError:
                    return
                i += 1
    except OSError:
        return


def _values(hive, path) -> dict:
    out = {}
    try:
        with winreg.OpenKey(hive, path) as k:
            i = 0
            while True:
                try:
                    name, val, _t = winreg.EnumValue(k, i)
                except OSError:
                    break
                out[name] = val
                i += 1
    except OSError:
        pass
    return out


def _uninstall_entries():
    for path, hive_name in UNINSTALL_KEYS:
        hive = _hive(hive_name)
        for sub in _subkeys(hive, path) or ():
            v = _values(hive, path + "\\" + sub)
            if v.get("DisplayName"):
                v["_key"] = sub
                yield v


def _game_from_folder(root: str, gid: str, source: str, platform: str, name: str, **extra) -> dict | None:
    """Usa o detector de jogos para achar o executável dentro da pasta instalada pela loja."""
    p = Path(root)
    if not p.is_dir():
        return None
    info = {}
    try:
        info = detect_game(p, "normal") or {}
    except Exception as e:
        log.debug("detect %s: %s", root, e)
    g = {
        "id": gid,
        "source": source,
        "root": str(p),
        "name_auto": clean_title(name) if name else p.name,
        "kind_auto": "normal",
        "platform": platform,
        "exe_auto": info.get("exe_auto"),
        "exes": info.get("exes") or [],
        "art_local": info.get("art_local") or {},
        "images": info.get("images") or [],
    }
    if info.get("steam_appid"):
        g["steam_appid"] = info["steam_appid"]
    g.update(extra)
    return g


# --- GOG --------------------------------------------------------------------------
def find_gog_games() -> list:
    games = []
    base = r"SOFTWARE\WOW6432Node\GOG.com\Games"
    hive = winreg.HKEY_LOCAL_MACHINE if winreg else None
    for gid in _subkeys(hive, base) or ():
        v = _values(hive, base + "\\" + gid)
        path = v.get("path") or v.get("PATH")
        if not path or not os.path.isdir(path):
            continue
        exe = v.get("exe") or v.get("EXE")
        g = _game_from_folder(path, f"gog_{gid}", "gog", "GOG", v.get("gameName") or v.get("GAMENAME") or "",
                              gog_id=gid,
                              art_urls={"gog": gid})
        if not g:
            continue
        if exe and os.path.isfile(exe):
            g["exe_auto"] = exe
            if exe not in g["exes"]:
                g["exes"].insert(0, exe)
        if v.get("launchParam"):
            g["args_auto"] = v["launchParam"]
        games.append(g)
    return games


# --- Ubisoft Connect ------------------------------------------------------------
def find_ubisoft_games() -> list:
    games = []
    base = r"SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs"
    hive = winreg.HKEY_LOCAL_MACHINE if winreg else None
    names = {}
    for e in _uninstall_entries():
        m = re.match(r"Uplay Install (\d+)$", e.get("_key", ""))
        if m:
            names[m.group(1)] = e["DisplayName"]
    for uid in _subkeys(hive, base) or ():
        v = _values(hive, base + "\\" + uid)
        path = (v.get("InstallDir") or "").replace("/", "\\").rstrip("\\")
        if not path or not os.path.isdir(path):
            continue
        g = _game_from_folder(path, f"ubisoft_{uid}", "ubisoft", "Ubisoft", names.get(uid) or Path(path).name,
                              launch_uri=f"uplay://launch/{uid}/0")
        if g:
            games.append(g)
    return games


# --- EA app e Battle.net (pelas entradas de desinstalação do Windows) -----------
_EA_SKIP = re.compile(r"^(EA app|EA Desktop|Origin|EA Installer)", re.I)
_BNET_SKIP = re.compile(r"^(Battle\.net|Blizzard Battle\.net)", re.I)


def find_ea_games() -> list:
    games, seen = [], set()
    for e in _uninstall_entries():
        if "electronic arts" not in str(e.get("Publisher", "")).lower() or _EA_SKIP.match(e["DisplayName"]):
            continue
        loc = str(e.get("InstallLocation") or "").strip('"').rstrip("\\")
        if not loc or loc.lower() in seen or not os.path.isdir(loc):
            continue
        # jogos do EA app/Origin têm a pasta __Installer
        if not os.path.isdir(os.path.join(loc, "__Installer")) and "steam" in loc.lower():
            continue
        seen.add(loc.lower())
        gid = "ea_" + hashlib.sha1(loc.lower().encode()).hexdigest()[:12]
        g = _game_from_folder(loc, gid, "ea", "EA", e["DisplayName"])
        if g:
            games.append(g)
    return games


def find_battlenet_games() -> list:
    games, seen = [], set()
    for e in _uninstall_entries():
        if "blizzard" not in str(e.get("Publisher", "")).lower() or _BNET_SKIP.match(e["DisplayName"]):
            continue
        loc = str(e.get("InstallLocation") or "").strip('"').rstrip("\\")
        if not loc or loc.lower() in seen or not os.path.isdir(loc):
            continue
        seen.add(loc.lower())
        gid = "bnet_" + hashlib.sha1(loc.lower().encode()).hexdigest()[:12]
        g = _game_from_folder(loc, gid, "battlenet", "Battle.net", e["DisplayName"])
        if g:
            games.append(g)
    return games


# --- Xbox / Game Pass (pastas XboxGames) -----------------------------------------
_CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz"


def publisher_id(publisher: str) -> str:
    """Hash do publisher usado no PackageFamilyName (Name_<hash>)."""
    digest = hashlib.sha256(publisher.encode("utf-16-le")).digest()[:8]
    bits = "".join(f"{b:08b}" for b in digest) + "0"
    return "".join(_CROCKFORD[int(bits[i:i + 5], 2)] for i in range(0, 65, 5))


def find_xbox_games() -> list:
    games = []
    drives = [f"{c}:\\" for c in string.ascii_uppercase if os.path.exists(f"{c}:\\")]
    for d in drives:
        base = Path(d) / "XboxGames"
        if not base.is_dir():
            continue
        for game_dir in base.iterdir():
            content = game_dir / "Content"
            cfg = content / "MicrosoftGame.config"
            if not cfg.is_file():
                continue
            try:
                root = ET.parse(cfg).getroot()
            except Exception:
                continue
            ident = root.find("Identity")
            visuals = root.find("ShellVisuals")
            exe_el = root.find("ExecutableList/Executable")
            if ident is None or exe_el is None:
                continue
            name = (visuals.get("DefaultDisplayName") if visuals is not None else None) or game_dir.name
            pfn = f"{ident.get('Name')}_{publisher_id(ident.get('Publisher', ''))}"
            app_id = exe_el.get("Id") or "Game"
            art = {}
            if visuals is not None:
                for attr, key in (("Square480x480Logo", "icon"), ("Square150x150Logo", "icon"), ("StoreLogo", "icon")):
                    f = visuals.get(attr)
                    if f and (content / f).is_file() and key not in art:
                        art[key] = str(content / f)
            gid = "xbox_" + (ident.get("Name") or game_dir.name).lower()
            exe = content / exe_el.get("Name", "")
            games.append({
                "id": gid,
                "source": "xbox",
                "root": str(content),
                "name_auto": clean_title(name) if not name.startswith("ms-resource") else game_dir.name,
                "kind_auto": "normal",
                "platform": "Xbox",
                "launch_uri": f"shell:AppsFolder\\{pfn}!{app_id}",
                "exe_auto": None,
                "exes": [str(exe)] if exe.is_file() else [],
                "art_local": art,
            })
    return games


STORES = {
    "import_gog": ("GOG", find_gog_games),
    "import_ubisoft": ("Ubisoft Connect", find_ubisoft_games),
    "import_ea": ("EA app", find_ea_games),
    "import_battlenet": ("Battle.net", find_battlenet_games),
    "import_xbox": ("Xbox", find_xbox_games),
}
