"""Importação de jogos instalados pela Steam e pela Epic Games."""
import glob
import json
import os
import re
from pathlib import Path

from .sfo import clean_title

try:
    import winreg
except ImportError:  # pragma: no cover
    winreg = None

_SKIP_STEAM_APPS = {228980, 1070560, 1391110, 1628350, 1493710, 250820, 1826330}
_SKIP_STEAM_NAMES = re.compile(r"(redistributable|proton|steam linux runtime|steamvr|dedicated server|\bsdk\b|soundtrack|steamworks)", re.I)


# --- VDF (KeyValues) ---------------------------------------------------------------
def parse_vdf(text: str) -> dict:
    tokens = re.findall(r'"((?:\\.|[^"\\])*)"|(\{)|(\})', text)
    root: dict = {}
    stack = [root]
    key = None
    for s, ob, cb in tokens:
        if ob:
            new = {}
            if key is not None:
                stack[-1][key] = new
            stack.append(new)
            key = None
        elif cb:
            if len(stack) > 1:
                stack.pop()
            key = None
        else:
            s = s.replace("\\\\", "\\")
            if key is None:
                key = s
            else:
                stack[-1][key] = s
                key = None
    return root


def _ci_get(d: dict, k: str):
    for kk, v in d.items():
        if kk.lower() == k.lower():
            return v
    return None


def steam_path() -> Path | None:
    if winreg:
        for hive, sub, val in (
            (winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamPath"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath"),
        ):
            try:
                with winreg.OpenKey(hive, sub) as k:
                    p = Path(winreg.QueryValueEx(k, val)[0])
                    if p.is_dir():
                        return p
            except OSError:
                pass
    p = Path(r"C:\Program Files (x86)\Steam")
    return p if p.is_dir() else None


def _steam_playtimes(sp: Path) -> dict:
    out = {}
    for cfg in glob.glob(str(sp / "userdata" / "*" / "config" / "localconfig.vdf")):
        try:
            data = parse_vdf(open(cfg, "r", encoding="utf-8", errors="replace").read())
            apps = data["UserLocalConfigStore"]["Software"]["Valve"]
            apps = _ci_get(_ci_get(apps, "Steam") or {}, "apps") or {}
        except (KeyError, TypeError, OSError):
            continue
        for appid, v in apps.items():
            if not isinstance(v, dict) or not appid.isdigit():
                continue
            minutes = int(v.get("Playtime", 0) or 0)
            last = int(v.get("LastPlayed", 0) or 0)
            cur = out.get(int(appid), (0, 0))
            out[int(appid)] = (max(cur[0], minutes), max(cur[1], last))
    return out


def steam_library_art(sp: Path, appid: int) -> dict:
    base = sp / "appcache" / "librarycache"
    art = {}
    wanted = {"cover": ("library_600x900_2x.jpg", "library_600x900.jpg"),
              "hero": ("library_hero.jpg",), "logo": ("logo.png",), "header": ("header.jpg",)}
    for key, names in wanted.items():
        for n in names:
            cands = [base / f"{appid}_{n}", base / str(appid) / n]
            cands += [Path(p) for p in glob.glob(str(base / str(appid) / "*" / n))]
            hit = next((c for c in cands if c.is_file()), None)
            if hit:
                art[key] = str(hit)
                break
    return art


def find_steam_games() -> list:
    sp = steam_path()
    if not sp:
        return []
    libs = {sp}
    vdf = sp / "steamapps" / "libraryfolders.vdf"
    try:
        data = parse_vdf(open(vdf, "r", encoding="utf-8", errors="replace").read())
        for v in (_ci_get(data, "libraryfolders") or {}).values():
            if isinstance(v, dict) and v.get("path"):
                libs.add(Path(v["path"]))
    except OSError:
        pass
    playtimes = _steam_playtimes(sp)
    games = []
    for lib in libs:
        for acf in glob.glob(str(lib / "steamapps" / "appmanifest_*.acf")):
            try:
                st = _ci_get(parse_vdf(open(acf, "r", encoding="utf-8", errors="replace").read()), "AppState") or {}
                appid = int(st.get("appid"))
            except (OSError, TypeError, ValueError):
                continue
            name = st.get("name") or f"App {appid}"
            if appid in _SKIP_STEAM_APPS or _SKIP_STEAM_NAMES.search(name):
                continue
            install = lib / "steamapps" / "common" / (st.get("installdir") or "")
            if not install.is_dir():
                continue
            pt = playtimes.get(appid, (0, 0))
            games.append({
                "id": f"steam_{appid}",
                "source": "steam",
                "root": str(install),
                "name_auto": clean_title(name),
                "kind_auto": "normal",
                "platform": "Steam",
                "steam_appid": appid,
                "launch_uri": f"steam://rungameid/{appid}",
                "exe_auto": None,
                "exes": [],
                "art_local": steam_library_art(sp, appid),
                "ext_playtime": pt[0] * 60,
                "ext_last_played": pt[1] or None,
            })
    return games


def find_epic_games() -> list:
    base = Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "Epic" / "EpicGamesLauncher" / "Data" / "Manifests"
    games = []
    for item in glob.glob(str(base / "*.item")):
        try:
            m = json.load(open(item, "r", encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if m.get("bIsIncompleteInstall"):
            continue
        cats = [c.lower() for c in m.get("AppCategories", [])]
        if cats and ("games" not in cats or "addons" in cats):
            continue
        loc = m.get("InstallLocation")
        if not loc or not Path(loc).is_dir():
            continue
        ns, cid, app = m.get("CatalogNamespace", ""), m.get("CatalogItemId", ""), m.get("AppName", "")
        exe = Path(loc) / m["LaunchExecutable"] if m.get("LaunchExecutable") else None
        games.append({
            "id": f"epic_{app}",
            "source": "epic",
            "root": loc,
            "name_auto": clean_title(m.get("DisplayName") or app),
            "kind_auto": "normal",
            "platform": "Epic",
            "launch_uri": f"com.epicgames.launcher://apps/{ns}%3A{cid}%3A{app}?action=launch&silent=true",
            "exe_auto": str(exe) if exe and exe.is_file() else None,
            "exes": [str(exe)] if exe and exe.is_file() else [],
            "art_local": {},
        })
    return games
