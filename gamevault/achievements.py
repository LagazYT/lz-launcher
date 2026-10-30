"""Conquistas e troféus reais.

Lista oficial:
- Ports de PS4/PS5: troféus da PSN pela Exophase (nome, descrição, tipo, raridade), ícones oficiais tirados do
  próprio dump (sce_sys/trophy/trophy00.trp) e, quando o port grava, os textos traduzidos dele.
- Jogos de PC: conquistas da Steam (arquivos de estatísticas da própria Steam no PC, o steam_settings do jogo ou a
  página pública de conquistas da Steam, que já vem traduzida) e a raridade global da Steam. Jogos de fora da
  Steam têm o AppID descoberto pelo nome.
- Jogos que não têm conquistas na Steam (Xbox, PS3, Ubisoft...): lista da Exophase da plataforma mais próxima.

Desbloqueio: lido dos arquivos que o jogo grava no PC (Steam, arquivos de conquistas no formato Goldberg/GSE,
CODEX/RUNE, OnlineFix e EMPRESS e a pasta de troféus dos ports). O LZ Launcher só lê esses arquivos.
"""
import glob
import hashlib
import html as htmlmod
import json
import logging
import os
import re
import struct
import time
import unicodedata
from configparser import ConfigParser
from pathlib import Path

from .art import _get, _norm_title
from .paths import cache_dir

log = logging.getLogger("gamevault.achievements")
STEAM_LANG = {"pt": "brazilian", "en": "english", "es": "spanish"}
STEAM_CDN = "https://shared.akamai.steamstatic.com/community_assets/images/apps/{appid}/{icon}"
# caminho antigo: parte dos ícones novos não existe mais nele
OLD_STEAM_ICON = ("cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/", "steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/",
                  "cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/")
NEW_STEAM_ICON = "shared.akamai.steamstatic.com/community_assets/images/apps/"


def fix_icon_url(url: str) -> str:
    for old in OLD_STEAM_ICON:
        if old in url:
            return url.replace(old, NEW_STEAM_ICON)
    return url


TROPHY_TYPES = ("platinum", "gold", "silver", "bronze")
VERSION = 2   # muda quando a busca melhora: jogos marcados "sem conquistas" são verificados de novo
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36"


# ------------------------------------------------------------------ KeyValues binário (Steam)
def read_kv(data: bytes, i: int = 0):
    out = {}
    while i < len(data):
        t = data[i]; i += 1
        if t in (0x08, 0x0B):
            return out, i
        end = data.index(b"\0", i); key = data[i:end].decode("utf-8", "replace"); i = end + 1
        if t == 0x00:
            out[key], i = read_kv(data, i)
        elif t == 0x01:
            end = data.index(b"\0", i); out[key] = data[i:end].decode("utf-8", "replace"); i = end + 1
        elif t == 0x02:
            out[key] = struct.unpack_from("<i", data, i)[0]; i += 4
        elif t == 0x03:
            out[key] = struct.unpack_from("<f", data, i)[0]; i += 4
        elif t == 0x07:
            out[key] = struct.unpack_from("<Q", data, i)[0]; i += 8
        else:
            raise ValueError(f"KV tipo {t}")
    return out, i


def _pick(d, lang):
    if isinstance(d, str):
        return d
    if not isinstance(d, dict):
        return ""
    return d.get(STEAM_LANG.get(lang, "english")) or d.get("latam" if lang == "es" else "") or d.get("english") or next(iter(d.values()), "")


def steam_path() -> Path | None:
    from .platforms import steam_path as sp
    return sp()


# ------------------------------------------------------------------ Steam: lista
def steam_local_schema(appid: int, lang: str) -> list | None:
    sp = steam_path()
    f = sp / "appcache" / "stats" / f"UserGameStatsSchema_{appid}.bin" if sp else None
    if not f or not f.is_file():
        return None
    try:
        root = next(iter(read_kv(f.read_bytes())[0].values()))
    except Exception as e:
        log.debug("schema %s: %s", appid, e)
        return None
    out = []
    for sid, st in (root.get("stats") or {}).items():
        if str(st.get("type")) not in ("ACHIEVEMENTS", "4"):
            continue
        for bit, info in (st.get("bits") or {}).items():
            disp = info.get("display") or {}
            icon = disp.get("icon") or ""
            out.append({
                "id": info.get("name") or f"{sid}_{bit}",
                "name": _pick(disp.get("name"), lang),
                "desc": _pick(disp.get("desc"), lang),
                "hidden": str(disp.get("hidden", "0")) == "1",
                "icon": STEAM_CDN.format(appid=appid, icon=icon) if icon else None,
                "icon_gray": STEAM_CDN.format(appid=appid, icon=disp["icon_gray"]) if disp.get("icon_gray") else None,
                "_stat": sid, "_bit": int(bit),
            })
    return out or None


def steam_settings_schema(root: str, lang: str) -> list | None:
    """steam_settings/achievements.json que alguns jogos trazem na pasta (formato Goldberg)."""
    for f in _find_files(root, "achievements.json", parent="steam_settings"):
        try:
            data = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue
        base = Path(f).parent
        out = []
        for a in data if isinstance(data, list) else []:
            def icon(v):
                if not v:
                    return None
                if str(v).startswith("http"):
                    return v
                p = base / v
                return str(p) if p.is_file() else None
            out.append({"id": a.get("name"), "name": _pick(a.get("displayName"), lang), "desc": _pick(a.get("description"), lang),
                        "hidden": str(a.get("hidden", 0)) in ("1", "True", "true"),
                        "icon": icon(a.get("icon")), "icon_gray": icon(a.get("icon_gray") or a.get("icongray"))})
        if out:
            return out
    return None


def steam_web_schema(appid: int, key: str, lang: str) -> list | None:
    if not key:
        return None
    r = _get("https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/",
             params={"appid": appid, "key": key, "l": STEAM_LANG.get(lang, "english")})
    try:
        ach = r.json()["game"]["availableGameStats"]["achievements"]
    except Exception:
        return None
    return [{"id": a["name"], "name": a.get("displayName") or a["name"], "desc": a.get("description") or "",
             "hidden": bool(a.get("hidden")), "icon": a.get("icon"), "icon_gray": a.get("icongray")} for a in ach] or None


def steam_community_schema(appid: int, lang: str) -> tuple[list | None, list | None]:
    """Lista completa (nome interno, nome, descrição, ícones, ocultas, raridade) da página pública da Steam, sem chave."""
    r = _get(f"https://steamcommunity.com/stats/{appid}/achievements/", params={"l": STEAM_LANG.get(lang, "english")},
             headers={"User-Agent": UA}, cookies={"Steam_Language": STEAM_LANG.get(lang, "english")})
    if not r or r.status_code != 200:
        return None, None
    m = re.search(r'<script type="application/json" id="valve-ssr-data"[^>]*>(.*?)</script>', r.text, re.S)
    try:
        queries = json.loads(json.loads(m.group(1))["renderContext"]["queryData"])["queries"]
    except Exception:
        return None, None
    schema, pct = None, {}
    for q in queries:
        key = q.get("queryKey") or []
        data = (q.get("state") or {}).get("data")
        if len(key) >= 3 and key[0] == "achievements" and key[2] == "schema_v2":
            schema = data
        elif len(key) >= 3 and key[0] == "achievements" and key[2] == "globalpercentages":
            pct = (data or {}).get("percentages") or {}
    if not schema:
        return None, None
    groups = [gr for gr in schema.get("groups") or [] if gr.get("achievements")]
    named = len(groups) > 1
    out = []
    for gr in groups:
        for a in gr["achievements"]:
            if a.get("archived"):
                continue
            p = pct.get(str(a.get("internal_key")))
            out.append({"id": a["api_name"], "name": a.get("name") or a["api_name"], "desc": a.get("description") or "",
                        "hidden": bool(a.get("hidden")),
                        "icon": STEAM_CDN.format(appid=appid, icon=a["icon_achieved"]) if a.get("icon_achieved") else None,
                        "icon_gray": STEAM_CDN.format(appid=appid, icon=a["icon_unachieved"]) if a.get("icon_unachieved") else None,
                        "rarity": round(float(p), 1) if p is not None else None,
                        **({"group": gr.get("name") or "—"} if named else {})})
    return (out or None), ([gr.get("name") or "—" for gr in groups] if named else None)


def _norm(t: str) -> str:
    """Nome comparável: sem acentos, símbolos, pontuação e espaços."""
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode()
    return _norm_title(t)


EXTRA_WORDS = re.compile(r"\b(soundtrack|ost|artbook|demo|dlc|pack|season pass|upgrade|bundle|playtest|beta|skin|costume|expansion)\b", re.I)


def steam_guess_appid(name: str) -> int | None:
    """AppID da Steam pelo nome do jogo (para jogos que vieram de pasta, sem steam_appid.txt)."""
    if not name:
        return None
    r = _get("https://store.steampowered.com/api/storesearch/", params={"term": name, "l": "english", "cc": "US"})
    try:
        items = r.json().get("items") or []
    except Exception:
        return None
    target = _norm(name)
    for it in items:
        if _norm(it["name"]) == target:
            return it["id"]
    for it in items:  # "Im not a human" -> "No, I'm not a Human"
        n = _norm(it["name"])
        if EXTRA_WORDS.search(it["name"]) or not n:
            continue
        if (target in n or n in target) and min(len(n), len(target)) / max(len(n), len(target)) >= 0.6:
            return it["id"]
    return None


def online() -> bool:
    """Tem internet? (para não marcar um jogo como "sem conquistas" só porque a rede caiu)"""
    import requests
    for url in ("https://store.steampowered.com/", "https://www.exophase.com/"):
        try:
            requests.head(url, timeout=6)
            return True
        except requests.RequestException:
            pass
    return False


def steam_global_percent(appid: int) -> dict:
    r = _get("https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/", params={"gameid": appid})
    try:
        return {a["name"]: round(float(a["percent"]), 1) for a in r.json()["achievementpercentages"]["achievements"]}
    except Exception:
        return {}


# ------------------------------------------------------------------ Steam: desbloqueios
def steam_user_unlocks(appid: int, schema: list) -> dict:
    sp = steam_path()
    if not sp:
        return {}
    by_bit = {(str(a.get("_stat")), a.get("_bit")): a["id"] for a in schema if a.get("_stat") is not None}
    if not by_bit:  # lista veio do site: usa o mapa de bits que a Steam guarda no PC quando o jogo roda
        by_bit = {(str(a.get("_stat")), a.get("_bit")): a["id"] for a in (steam_local_schema(appid, "en") or [])
                  if a.get("_stat") is not None}
    out = {}
    for f in glob.glob(str(sp / "appcache" / "stats" / f"UserGameStats_*_{appid}.bin")):
        try:
            cache = read_kv(Path(f).read_bytes())[0].get("cache", {})
        except Exception:
            continue
        for sid, st in cache.items():
            if not isinstance(st, dict) or "data" not in st:
                continue
            data, times = int(st.get("data") or 0) & 0xFFFFFFFF, st.get("AchievementTimes") or {}
            for bit in range(32):
                aid = by_bit.get((sid, bit))
                if aid and data & (1 << bit):
                    out[aid] = max(out.get(aid, 0), int(times.get(str(bit)) or 0)) or out.get(aid, 0) or 1
    return out


def emulator_files(appid: int, root: str | None) -> list:
    """Arquivos de conquistas que jogos fora da Steam gravam (vários formatos)."""
    a, pub, doc = os.environ.get("APPDATA", ""), os.environ.get("PUBLIC", r"C:\Users\Public"), os.path.expanduser(r"~\Documents")
    cands = [
        Path(a) / "Goldberg SteamEmu Saves" / str(appid) / "achievements.json",
        Path(a) / "GSE Saves" / str(appid) / "achievements.json",
        Path(a) / "EMPRESS" / str(appid) / "remote" / str(appid) / "achievements.json",
        Path(a) / "Steam" / "CODEX" / str(appid) / "achievements.ini",
        Path(pub) / "Documents" / "Steam" / "CODEX" / str(appid) / "achievements.ini",
        Path(pub) / "Documents" / "Steam" / "RUNE" / str(appid) / "achievements.ini",
        Path(pub) / "Documents" / "OnlineFix" / str(appid) / "Stats" / "Achievements.ini",
        Path(doc) / "SKIDROW" / str(appid) / "SteamEmu" / "UserStats" / "achiev.ini",
    ]
    return [str(p) for p in cands if p.is_file()]


def parse_unlock_file(path: str) -> dict:
    out = {}
    try:
        if path.lower().endswith(".json"):
            data = json.load(open(path, encoding="utf-8", errors="replace"))
            if isinstance(data, dict):
                for k, v in data.items():
                    if isinstance(v, dict) and (v.get("earned") or v.get("achieved") or v.get("Achieved")):
                        out[k] = int(v.get("earned_time") or v.get("unlock_time") or v.get("UnlockTime") or 1)
            return out
        cp = ConfigParser(strict=False, interpolation=None)
        cp.optionxform = str
        cp.read_string(open(path, encoding="utf-8", errors="replace").read())
        for sec in cp.sections():
            s = cp[sec]
            if sec in ("SteamAchievements", "Steam"):
                continue
            ach = (s.get("Achieved") or s.get("achieved") or s.get("State") or "").strip().lower()
            if ach in ("1", "true"):
                out[sec] = int(float(s.get("UnlockTime") or s.get("timestamp") or s.get("Time") or 1))
        if not out and cp.has_section("SteamAchievements"):  # formato SKIDROW/antigo: nome=1
            for k, v in cp["SteamAchievements"].items():
                if k.lower() != "count" and v.strip() == "1":
                    out[k] = 1
    except Exception as e:
        log.debug("unlock %s: %s", path, e)
    return out


def find_appid(root: str | None) -> int | None:
    """AppID da Steam guardado na pasta do jogo (steam_appid.txt, steam_settings, steam_emu.ini, OnlineFix.ini)."""
    if not root:
        return None
    for f in _find_files(root, "steam_appid.txt", parent=None, max_depth=3):
        try:
            txt = open(f, encoding="utf-8", errors="ignore").read().strip()
            if txt.isdigit():
                return int(txt)
        except OSError:
            pass
    for name, key in (("steam_emu.ini", "AppId"), ("OnlineFix.ini", "RealAppId"), ("cream_api.ini", "appid")):
        for f in _find_files(root, name, parent=None, max_depth=3):
            m = re.search(rf"^\s*{key}\s*=\s*(\d+)", open(f, encoding="utf-8", errors="ignore").read(), re.M | re.I)
            if m:
                return int(m.group(1))
    return None


# ------------------------------------------------------------------ PSN (ports)
def np_ids(dump: str | None) -> list:
    if not dump:
        return []
    f = Path(dump) / "sce_sys" / "npbind.dat"
    try:
        return sorted({m.decode() for m in re.findall(rb"NPWR\d{5}_\d{2}", f.read_bytes())})
    except OSError:
        return []


def trp_files(dump: str | None) -> list:
    return sorted(glob.glob(str(Path(dump) / "sce_sys" / "trophy" / "trophy*.trp"))) if dump else []


def trp_icons(dump: str | None, gid: str, trp: str | None = None) -> dict:
    """Extrai os ícones oficiais dos troféus de sce_sys/trophy/trophyNN.trp (os PNGs não são criptografados)."""
    trps = [trp] if trp else trp_files(dump)
    if not trps:
        return {}
    out_dir = cache_dir("trophies") / gid / Path(trps[0]).stem
    out_dir.mkdir(parents=True, exist_ok=True)
    icons = {}
    try:
        d = open(trps[0], "rb").read()
        _magic, _ver, _size, count, esize = struct.unpack(">IIQII", d[:24])
        for i in range(count):
            e = d[0x60 + i * esize:0x60 + (i + 1) * esize]
            name = e[:32].split(b"\0")[0].decode("ascii", "replace")
            m = re.match(r"TROP(\d{3})\.PNG$", name, re.I)
            if not m and name.upper() != "ICON0.PNG":
                continue
            off, ln = struct.unpack(">QQ", e[32:48])
            target = out_dir / name.lower()
            if not target.is_file():
                target.write_bytes(d[off:off + ln])
            if m:
                icons[int(m.group(1))] = str(target)
            else:
                icons["set"] = str(target)
    except Exception as e:
        log.debug("trp %s: %s", trps[0], e)
    return icons


def exophase_search(query: str, platform: str | None = "psn") -> list:
    params = {"q": query}
    if platform:
        params["platform"] = platform
    r = _get("https://api.exophase.com/public/archive/games", params=params)
    try:
        return r.json()["games"]["list"]
    except Exception:
        return []


def exophase_trophies(name: str, platform: str = "ps4") -> list | None:
    games = exophase_search(name)
    if not games:
        return None
    target = _norm_title(name)

    def score(g):
        plats = {p.get("slug") for p in g.get("platforms") or []}
        n = _norm_title(g.get("title", ""))
        return (n == target) * 4 + (target in n or n in target) * 2 + (platform in plats) * 5
    games = sorted(games, key=score, reverse=True)
    if not games or score(games[0]) < 6:
        return None
    return exophase_awards(games[0].get("endpoint_awards"))


# plataforma do jogo -> plataformas da Exophase, na ordem de preferência
EXO_PREF = {
    "Xbox One": ["xbox-one", "xbox-series", "windows-10", "xbox-360"],
    "Xbox 360": ["xbox-360", "xbox-one"],
    "Xbox Series": ["xbox-series", "xbox-one", "windows-10"],
    "PS3": ["ps3", "ps4"],
    "PS4": ["ps4", "ps5"],
    "PS5": ["ps5", "ps4"],
}
PC_PREF = ["steam", "gog", "epic", "windows-10", "xbox-series", "xbox-one", "ps5", "ps4", "xbox-360", "ps3"]
PS_PLATS = {"ps3", "ps4", "ps5", "psn-pc", "vita"}


def exophase_any(name: str, platform: str | None) -> tuple[list | None, str | None]:
    """Lista da Exophase para jogos sem conquistas na Steam: mesmo nome, plataforma mais próxima."""
    games = exophase_search(name, None)
    target = _norm(name)
    pref = EXO_PREF.get(platform or "", []) + [p for p in PC_PREF if p not in EXO_PREF.get(platform or "", [])]
    best, best_rank = None, None
    for g in games:
        n = _norm(g.get("title", ""))
        if n != target and not (n.startswith(target) and len(target) / max(len(n), 1) >= 0.75):
            continue
        slugs = [p.get("slug") for p in g.get("platforms") or []]
        rank = min((pref.index(s) for s in slugs if s in pref), default=None)
        if rank is None:
            continue
        rank += 0 if n == target else 50
        if best_rank is None or rank < best_rank:
            best, best_rank = g, rank
    if not best:
        return None, None
    lst = exophase_awards(best.get("endpoint_awards"))
    slug = next((p.get("slug") for p in best.get("platforms") or [] if p.get("slug") in pref), "")
    return lst, slug


EXO_NAMES = {"xbox-one": "Xbox", "xbox-series": "Xbox", "xbox-360": "Xbox 360", "windows-10": "Xbox (PC)", "steam": "Steam",
             "gog": "GOG", "epic": "Epic Games", "ps3": "PSN", "ps4": "PSN", "ps5": "PSN", "psn-pc": "PSN"}


def exophase_awards(url: str | None) -> list | None:
    page = _get(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36"}) if url else None
    if not page or page.status_code != 200:
        return None
    out = []
    for block in re.split(r'(?=<li class="[^"]*\baward\b)', page.text)[1:]:
        m_id = re.search(r'data-award-id="(\d+)"', block)
        if not m_id:
            continue
        title = re.search(r'award-title[^>]*>\s*<a[^>]*>(.*?)</a>', block, re.S)
        desc = re.search(r'award-description[^>]*>\s*<p>(.*?)</p>', block, re.S)
        img = re.search(r'\ssrc="(https?://[^"]+\.(?:png|jpe?g|webp)[^"]*)"', block)
        typ = re.search(r'exo-icon-trophy-(platinum|gold|silver|bronze)', block)
        avg = re.search(r'data-average="([\d.]+)"', block)
        out.append({
            "id": int(m_id.group(1)) - 1,
            "name": htmlmod.unescape(re.sub(r"<[^>]+>", "", title.group(1)).strip()) if title else "",
            "desc": htmlmod.unescape(re.sub(r"<[^>]+>", "", desc.group(1)).strip()) if desc else "",
            "type": typ.group(1) if typ else "bronze",
            "icon": img.group(1).split("?")[0].replace("/awards/s/", "/awards/m/") if img else None,  # versão média, mais nítida
            "rarity": round(float(avg.group(1)), 1) if avg else None,
            "hidden": False,
        })
    # DLCs recomeçam a numeração na Exophase; no arquivo de troféus do PS4 elas continuam em sequência
    if len({a["id"] for a in out}) < len(out):
        for i, a in enumerate(out):
            a["id"] = i
    return out or None


def collection_sets(name: str, count: int, platform: str = "ps4") -> list:
    """Acha na Exophase os jogos de uma coletânea (um por arquivo de troféus), em ordem (1, 2, 3...)."""
    franchise = re.split(r"[:\-–]", name)[0].strip()
    games = [g for g in exophase_search(franchise)
             if platform in {p.get("slug") for p in g.get("platforms") or []} and "remaster" in g.get("title", "").lower()]
    if len(games) < count:
        return []

    def order(g):
        m = re.search(r"\b(\d)\b", g["title"])
        return int(m.group(1)) if m else 1
    return sorted(games, key=order)[:count]


def port_texts(root: str | None) -> dict:
    """Textos traduzidos que alguns ports gravam (ex.: trophy_texts.txt do God of War III)."""
    out = {}
    for f in _find_files(root, "trophy_texts.txt", parent=None, max_depth=3):
        for line in open(f, encoding="utf-8", errors="replace"):
            m = re.match(r"^(\d+)=(.*?)\s*\|\s*(.*)$", line.strip())
            if m:
                out[int(m.group(1))] = (m.group(2).strip(), m.group(3).strip())
        if out:
            break
    return out


def port_trophy_files(root: str | None) -> list:
    """Arquivos de progresso de troféus gravados pelo port (pastas trophy / TrophyFiles)."""
    if not root:
        return []
    files = []
    for d in _find_dirs(root, ("trophy", "trophyfiles"), max_depth=6):
        for dirpath, _dirs, names in os.walk(d):
            for n in names:
                if n.lower().endswith((".xml", ".json", ".dat", ".ini", ".txt")) and "notice" not in n.lower():
                    files.append(os.path.join(dirpath, n))
    return files[:200]


def parse_port_unlocks(files: list) -> dict:
    out = {}
    for f in files:
        try:
            text = open(f, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        if f.lower().endswith(".xml"):
            for m in re.finditer(r"<trophy\b([^>]*)>", text, re.I):
                attrs = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
                state = (attrs.get("unlockstate") or attrs.get("unlocked") or "").lower()
                if state in ("true", "1", "yes") and attrs.get("id", "").isdigit():
                    ts = attrs.get("timestamp") or attrs.get("time") or "1"
                    out[int(attrs["id"])] = int(ts) if ts.isdigit() else 1
        elif f.lower().endswith(".json"):
            try:
                data = json.loads(text)
            except ValueError:
                continue
            items = data.get("trophies", data) if isinstance(data, dict) else data
            if isinstance(items, dict):
                items = [dict(v, id=k) if isinstance(v, dict) else {"id": k, "unlocked": v} for k, v in items.items()]
            for t in items if isinstance(items, list) else []:
                if isinstance(t, dict) and (t.get("unlocked") or t.get("earned")) and str(t.get("id", "")).isdigit():
                    out[int(t["id"])] = int(t.get("timestamp") or t.get("time") or 1)
    # timestamps do PS4 vêm em microssegundos desde 2000 ou em segundos Unix: normaliza para segundos Unix
    for k, v in list(out.items()):
        if v > 10 ** 14:
            out[k] = int(v / 1_000_000) + 946684800 if v < 10 ** 17 else int(v / 1_000_000)
        elif v > 10 ** 11:
            out[k] = int(v / 1000)
    return out


# ------------------------------------------------------------------ utilidades
def _find_files(root, name, parent=None, max_depth=3):
    if not root or not os.path.isdir(root):
        return []
    res, base_depth = [], str(root).rstrip("\\/").count(os.sep)
    for dirpath, dirs, files in os.walk(root):
        if dirpath.count(os.sep) - base_depth >= max_depth:
            dirs[:] = []
        dirs[:] = [d for d in dirs if d.lower() not in ("_internal", "runtime", "dvdroot_ps4", "sce_module", "shader", "shaders", "cache")]
        for f in files:
            if f.lower() == name.lower() and (parent is None or os.path.basename(dirpath).lower() == parent.lower()):
                res.append(os.path.join(dirpath, f))
        if len(res) > 20:
            break
    return res


def _find_dirs(root, names, max_depth=6):
    res, base_depth = [], str(root).rstrip("\\/").count(os.sep)
    for dirpath, dirs, _files in os.walk(root):
        if dirpath.count(os.sep) - base_depth >= max_depth:
            dirs[:] = []
        dirs[:] = [d for d in dirs if d.lower() not in ("_internal", "runtime", "dvdroot_ps4", "sce_module", "shader", "shaders", "cache", "custom_trophy")]
        for d in dirs:
            if d.lower() in names:
                res.append(os.path.join(dirpath, d))
    return res


def files_signature(files: list) -> str:
    parts = []
    for f in files:
        try:
            st = os.stat(f)
            parts.append(f"{f}:{st.st_mtime_ns}:{st.st_size}")
        except OSError:
            pass
    return hashlib.md5("|".join(parts).encode()).hexdigest()


# ------------------------------------------------------------------ montagem por jogo
def build_list(g: dict, gid: str, lang: str, steam_key: str = "") -> dict | None:
    """Monta a lista oficial de conquistas de um jogo (ou None se não houver)."""
    kind = g.get("kind") or g.get("kind_auto")
    name = g.get("name") or g.get("name_auto") or ""
    if kind == "recompiled" and str(g.get("platform", "")).startswith("PS"):
        plat = "ps5" if g.get("platform") == "PS5" else "ps4"
        trps = trp_files(g.get("dump"))
        if len(trps) > 1:
            sets = collection_sets(name, len(trps), plat)
            if sets:
                lst = []
                for k, (trp, game) in enumerate(zip(trps, sets), start=1):
                    icons_k = trp_icons(g.get("dump"), gid, trp)
                    for a in exophase_awards(game.get("endpoint_awards")) or []:
                        a["icon"] = icons_k.get(a["id"]) or a["icon"]
                        a["id"] = f"{k}:{a['id']}"
                        a["group"] = game["title"]
                        lst.append(a)
                if lst:
                    return {"kind": "psn", "list": lst, "lang": lang, "np": np_ids(g.get("dump")), "groups": [x["title"] for x in sets],
                            "source": "PSN (Exophase)", "t": time.time()}
        icons = trp_icons(g.get("dump"), gid)
        lst = exophase_trophies(name, "ps5" if g.get("platform") == "PS5" else "ps4")
        texts = port_texts(g.get("root"))
        if not lst and not texts and not icons:
            return None
        if not lst:  # sem internet/sem cadastro: usa o que o port e o dump oferecem
            ids = sorted(set(texts) | {k for k in icons if isinstance(k, int)})
            lst = [{"id": i, "name": f"#{i}", "desc": "", "type": "bronze", "icon": None, "rarity": None, "hidden": False} for i in ids]
        for a in lst:
            if a["id"] in texts:
                a["name"], a["desc"] = texts[a["id"]]
            if a["id"] in icons:
                a["icon"] = icons[a["id"]]
        for a in lst:
            a["id"] = str(a["id"])
        return {"kind": "psn", "list": lst, "lang": lang, "np": np_ids(g.get("dump")), "set_icon": icons.get("set"),
                "source": "PSN (Exophase)" + (" + port" if texts else ""), "t": time.time()}
    is_pc = kind != "recompiled"
    appid = g.get("steam_appid") or find_appid(g.get("root")) or g.get("steam_appid_guess")
    if not appid and is_pc:
        appid = steam_guess_appid(name)
    groups = None
    if appid:
        appid = int(appid)
        lst, source = steam_local_schema(appid, lang), "Steam"
        if not lst:
            lst, source = steam_settings_schema(g.get("root"), lang), "Steam (steam_settings)"
        if not lst:
            lst, groups = steam_community_schema(appid, lang)
            source = "Steam"
        if not lst:
            lst, source = steam_web_schema(appid, steam_key, lang), "Steam Web API"
        if lst:
            if any(a.get("rarity") is None for a in lst):
                pct = steam_global_percent(appid)
                for a in lst:
                    if a.get("rarity") is None:
                        a["rarity"] = pct.get(a["id"])
            for a in lst:
                a.setdefault("type", None)
            return {"kind": "steam", "appid": appid, "list": lst, "lang": lang, "source": source, "groups": groups, "t": time.time()}
    # sem conquistas na Steam (Ubisoft, Xbox, PS3...): Exophase
    lst, slug = exophase_any(name, None if is_pc else g.get("platform"))
    if not lst:
        return None
    ps = slug in PS_PLATS
    for a in lst:
        a["id"] = str(a["id"])
        if not ps:
            a["type"] = None
    return {"kind": "psn" if ps else "exo", "appid": appid, "list": lst, "lang": lang,
            "source": f"{EXO_NAMES.get(slug, slug)} (Exophase)", "t": time.time()}


def watch_targets(g: dict, ach: dict) -> dict:
    """Onde procurar os desbloqueios deste jogo (calculado uma vez e reaproveitado)."""
    if ach["kind"] == "psn":
        return {"dirs": _find_dirs(g.get("root"), ("trophy", "trophyfiles"), max_depth=6) if g.get("root") else [], "paths": [], "globs": []}
    appid = ach.get("appid")
    if not appid:
        return {"dirs": [], "paths": [], "globs": []}
    a, pub, doc = os.environ.get("APPDATA", ""), os.environ.get("PUBLIC", r"C:\Users\Public"), os.path.expanduser(r"~\Documents")
    paths = [
        os.path.join(a, "Goldberg SteamEmu Saves", str(appid), "achievements.json"),
        os.path.join(a, "GSE Saves", str(appid), "achievements.json"),
        os.path.join(a, "EMPRESS", str(appid), "remote", str(appid), "achievements.json"),
        os.path.join(a, "Steam", "CODEX", str(appid), "achievements.ini"),
        os.path.join(pub, "Documents", "Steam", "CODEX", str(appid), "achievements.ini"),
        os.path.join(pub, "Documents", "Steam", "RUNE", str(appid), "achievements.ini"),
        os.path.join(pub, "Documents", "OnlineFix", str(appid), "Stats", "Achievements.ini"),
        os.path.join(doc, "SKIDROW", str(appid), "SteamEmu", "UserStats", "achiev.ini"),
    ]
    sp = steam_path()
    globs = [str(sp / "appcache" / "stats" / f"UserGameStats_*_{appid}.bin")] if sp else []
    return {"dirs": [], "paths": paths, "globs": globs}


def detect_label(files: list) -> str | None:
    """De onde os desbloqueios deste jogo estão sendo lidos (para mostrar na página do jogo)."""
    rules = [("/appcache/stats/", "Steam"), ("/gse saves/", "Goldberg/GSE"), ("/goldberg steamemu saves/", "Goldberg/GSE"),
             ("/rune/", "RUNE"), ("/codex/", "CODEX"), ("onlinefix", "OnlineFix"), ("/empress/", "EMPRESS"), ("skidrow", "SKIDROW")]
    names = []
    for f in files:
        low = f.replace(chr(92), "/").lower()
        n = next((label for key, label in rules if key in low), "port")
        if n not in names:
            names.append(n)
    return ", ".join(names) or None


def collect_files(targets: dict) -> list:
    files = [p for p in targets.get("paths", []) if os.path.isfile(p)]
    for pattern in targets.get("globs", []):
        files += glob.glob(pattern)
    for d in targets.get("dirs", []):
        for dirpath, _dirs, names in os.walk(d):
            for n in names:
                if n.lower().endswith((".xml", ".json", ".dat", ".ini", ".txt")) and "notice" not in n.lower():
                    files.append(os.path.join(dirpath, n))
    return files[:300]


def unlock_files(g: dict, ach: dict) -> list:
    if ach["kind"] == "psn":
        return port_trophy_files(g.get("root"))
    if not ach.get("appid"):
        return []
    files = emulator_files(ach["appid"], g.get("root"))
    sp = steam_path()
    if sp:
        files += glob.glob(str(sp / "appcache" / "stats" / f"UserGameStats_*_{ach['appid']}.bin"))
    return files


def read_unlocks(g: dict, ach: dict, files: list) -> dict:
    if ach["kind"] == "psn":
        return {str(k): v for k, v in parse_port_unlocks(files).items()}
    out = {}
    if not ach.get("appid"):
        return out
    if any(f.endswith(".bin") for f in files):
        out.update(steam_user_unlocks(ach["appid"], ach["list"]))
    ids = {a["id"].lower(): a["id"] for a in ach["list"]}
    for f in files:
        if f.endswith(".bin"):
            continue
        for k, ts in parse_unlock_file(f).items():
            real = ids.get(str(k).lower())
            if real:
                out[real] = max(out.get(real, 0), ts)
    return out
