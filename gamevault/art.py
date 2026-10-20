"""Capas e imagens de fundo: arte local, Steam, SteamGridDB, Wikipédia e ícone do .exe."""
import hashlib
import io
import logging
import re
import time
from pathlib import Path

import requests

from .paths import cache_dir

log = logging.getLogger("gamevault.art")
UA = {"User-Agent": "LZLauncher/1.1 (personal game library launcher)"}
STEAM_CDN = [
    "https://shared.steamstatic.com/store_item_assets/steam/apps/{id}/{f}",
    "https://cdn.cloudflare.steamstatic.com/steam/apps/{id}/{f}",
]
_session = requests.Session()
_session.headers.update(UA)


def _norm_title(t: str) -> str:
    t = t.lower().replace("&", "and")
    t = re.sub(r"[™®©]", "", t)
    t = re.sub(r"\b(remastered|definitive edition|game of the year|goty|edition|pc port)\b", "", t)
    return re.sub(r"[^a-z0-9]", "", t)


def _get(url, **kw):
    for attempt in range(3):
        try:
            r = _session.get(url, timeout=12, **kw)
            if r.status_code == 429:
                time.sleep(1.5 * (attempt + 1))
                continue
            return r
        except requests.RequestException:
            time.sleep(0.6)
    return None


def download(url: str, game_id: str, kind: str) -> str | None:
    r = _get(url)
    if not r or r.status_code != 200 or len(r.content) < 1500:
        return None
    ctype = r.headers.get("content-type", "")
    if "html" in ctype:
        return None
    ext = ".png" if "png" in ctype or url.lower().split("?")[0].endswith(".png") else ".jpg"
    h = hashlib.sha1(url.encode()).hexdigest()[:8]
    out = cache_dir("art") / f"{game_id}_{kind}_{h}{ext}"
    out.write_bytes(r.content)
    return str(out)


# --- Steam ------------------------------------------------------------------------
def steam_search(name: str, limit=6) -> list:
    r = _get("https://store.steampowered.com/api/storesearch/", params={"term": name, "l": "english", "cc": "US"})
    try:
        return [{"id": i["id"], "name": i["name"]} for i in r.json().get("items", [])][:limit]
    except Exception:
        return []


def steam_match(name: str) -> int | None:
    """Só aceita o resultado se o nome normalizado for igual (evita capa errada)."""
    target = _norm_title(name)
    for it in steam_search(name):
        if _norm_title(it["name"]) == target:
            return it["id"]
    return None


def steam_art_urls(appid: int) -> dict:
    return {
        "cover": [c.format(id=appid, f=f) for f in ("library_600x900_2x.jpg", "library_600x900.jpg") for c in STEAM_CDN],
        "hero": [c.format(id=appid, f="library_hero.jpg") for c in STEAM_CDN],
        "header": [c.format(id=appid, f="header.jpg") for c in STEAM_CDN],
    }


def steam_download(appid: int, game_id: str, kind: str) -> str | None:
    for url in steam_art_urls(appid)[kind]:
        p = download(url, game_id, kind)
        if p:
            return p
    return None


# --- SteamGridDB (opcional, precisa de chave da API) -------------------------------
def sgdb_search(name: str, key: str) -> list:
    if not key:
        return []
    r = _get(f"https://www.steamgriddb.com/api/v2/search/autocomplete/{requests.utils.quote(name)}",
             headers={"Authorization": f"Bearer {key}"})
    try:
        return r.json().get("data", [])
    except Exception:
        return []


def sgdb_images(game_id_sgdb: int, key: str, kind: str) -> list:
    path = {"cover": "grids", "hero": "heroes", "logo": "logos"}[kind]
    params = {"dimensions": "600x900,342x482,660x930"} if kind == "cover" else {}
    r = _get(f"https://www.steamgriddb.com/api/v2/{path}/game/{game_id_sgdb}", params=params,
             headers={"Authorization": f"Bearer {key}"})
    try:
        return [i["url"] for i in r.json().get("data", [])]
    except Exception:
        return []


# --- Wikipédia (capa da caixa do jogo, sem chave) -----------------------------------
def wikipedia_boxart(name: str) -> dict | None:
    r = _get("https://en.wikipedia.org/w/api.php", params={
        "action": "query", "list": "search", "srsearch": f"{name} video game", "format": "json", "srlimit": 5})
    try:
        hits = [h["title"] for h in r.json()["query"]["search"]]
    except Exception:
        return None
    target = _norm_title(name)
    # prioriza títulos que batem com o nome
    hits.sort(key=lambda h: 0 if _norm_title(re.sub(r"\(.*?\)", "", h)) == target else 1)
    for title in hits[:3]:
        s = _get("https://en.wikipedia.org/api/rest_v1/page/summary/" + requests.utils.quote(title.replace(" ", "_")))
        try:
            js = s.json()
        except Exception:
            continue
        desc = (js.get("description") or "").lower()
        img = (js.get("originalimage") or {}).get("source")
        page_norm = _norm_title(re.sub(r"\(.*?\)", "", title))
        if img and "video game" in desc and (page_norm == target or target in page_norm or page_norm in target):
            w = (js.get("originalimage") or {}).get("width", 0)
            h = (js.get("originalimage") or {}).get("height", 0)
            return {"url": img.split("?")[0], "title": title, "portrait": h >= w * 1.05}
    return None


# --- Ícone do executável -----------------------------------------------------------
def exe_icon(exe_path: str, game_id: str) -> str | None:
    out = cache_dir("icons") / f"{game_id}.png"
    try:
        if out.is_file() and out.stat().st_mtime >= Path(exe_path).stat().st_mtime:
            return str(out)
    except OSError:
        return None
    try:
        from icoextract import IconExtractor
        from PIL import Image
        ext = IconExtractor(exe_path)
        data = ext.get_icon(num=0)
        img = Image.open(data)
        sizes = sorted(getattr(img, "ico", None).sizes() if hasattr(img, "ico") else [img.size], reverse=True)
        if hasattr(img, "ico"):
            img = img.ico.getimage(sizes[0])
        img.convert("RGBA").save(out)
        return str(out)
    except Exception as e:  # sem ícone ou formato não suportado
        log.debug("icon fail %s: %s", exe_path, e)
        return None


def image_size(path: str):
    try:
        from PIL import Image
        with Image.open(path) as im:
            return im.size
    except Exception:
        return None


def candidate_search(name: str, steam_appid: int | None, sgdb_key: str) -> list:
    """Lista de capas online para o usuário escolher."""
    out = []
    ids = []
    if steam_appid:
        ids.append((steam_appid, name))
    for it in steam_search(name, limit=4):
        if it["id"] not in [i for i, _ in ids]:
            ids.append((it["id"], it["name"]))
    for appid, label in ids[:5]:
        urls = steam_art_urls(appid)
        out.append({"url": urls["cover"][0], "kind": "cover", "label": f"Steam: {label}"})
        out.append({"url": urls["hero"][0], "kind": "hero", "label": f"Steam: {label}"})
    wb = wikipedia_boxart(name)
    if wb:
        out.insert(0, {"url": wb["url"], "kind": "cover", "label": f"Wikipédia: {wb['title']}"})
    if sgdb_key:
        for g in sgdb_search(name, sgdb_key)[:2]:
            for u in sgdb_images(g["id"], sgdb_key, "cover")[:6]:
                out.insert(0, {"url": u, "kind": "cover", "label": f"SteamGridDB: {g.get('name')}"})
            for u in sgdb_images(g["id"], sgdb_key, "hero")[:3]:
                out.append({"url": u, "kind": "hero", "label": f"SteamGridDB: {g.get('name')}"})
    return out
