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
    for attempt in range(5):
        try:
            r = _session.get(url, timeout=12, **kw)
            if r.status_code == 429:  # limite de requisições: espera o tempo pedido pelo servidor
                try:
                    wait = float(r.headers.get("Retry-After") or 0)
                except ValueError:
                    wait = 0
                time.sleep(min(max(wait, 2.0 * (attempt + 1)), 20))
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


# --- GOG ----------------------------------------------------------------------------
def gog_art_urls(gog_id: str) -> dict:
    r = _get(f"https://api.gog.com/v2/games/{gog_id}", params={"locale": "en-US"})
    try:
        links = r.json().get("_links", {})
    except Exception:
        return {}
    return {"cover": (links.get("boxArtImage") or {}).get("href"),
            "hero": (links.get("backgroundImage") or {}).get("href")}


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


def sgdb_game_id(key: str, appid: int | None = None, name: str | None = None) -> int | None:
    """Jogo no SteamGridDB: pelo AppID da Steam (exato) ou pelo nome."""
    if not key:
        return None
    if appid:
        r = _get(f"https://www.steamgriddb.com/api/v2/games/steam/{appid}", headers={"Authorization": f"Bearer {key}"})
        try:
            if r.json().get("success"):
                return r.json()["data"]["id"]
        except Exception:
            pass
    if name:
        target = _norm_title(name)
        for hit in sgdb_search(name, key)[:5]:
            if _norm_title(hit.get("name", "")) == target:
                return hit["id"]
    return None


def sgdb_square(key: str, sgdb_id: int) -> list:
    """Artes quadradas (estilo bloco de console) mais bem votadas."""
    r = _get(f"https://www.steamgriddb.com/api/v2/grids/game/{sgdb_id}",
             params={"dimensions": "512x512,1024x1024", "nsfw": "false", "humor": "false", "types": "static"},
             headers={"Authorization": f"Bearer {key}"})
    try:
        return [i["url"] for i in r.json().get("data", [])]
    except Exception:
        return []


def sgdb_official_logo(key: str, sgdb_id: int) -> list:
    r = _get(f"https://www.steamgriddb.com/api/v2/logos/game/{sgdb_id}", params={"styles": "official", "types": "static"},
             headers={"Authorization": f"Bearer {key}"})
    try:
        return [i["url"] for i in r.json().get("data", [])]
    except Exception:
        return []


# --- Bloco quadrado (Modo TV do tema Xbox) -------------------------------------------
TILE_SIZE = 600


def _tile_out(game_id: str, tag: str) -> Path:
    return cache_dir("art") / f"{game_id}_tile_{hashlib.sha1(tag.encode()).hexdigest()[:8]}.jpg"


def is_square(path: str, min_side=256) -> bool:
    size = image_size(path)
    return bool(size) and size[0] == size[1] and size[0] >= min_side


def has_frame(path: str) -> bool:
    """Arte com moldura clara em volta (cartaz com borda branca): não serve como bloco."""
    try:
        from PIL import Image, ImageStat
        with Image.open(path) as im:
            if im.mode in ("RGBA", "LA", "P"):
                alpha = im.convert("RGBA").getchannel("A").resize((200, 200))
                if min(alpha.getpixel(p) for p in ((1, 1), (198, 1), (1, 198), (198, 198), (100, 1), (1, 100))) < 250:
                    return True  # cantos/bordas transparentes: arte com moldura recortada
            im = im.convert("L").resize((200, 200))
            # borda externa de cor única com algo bem diferente logo por dentro = moldura (cartaz, faixa, borda branca)
            outer = [(0, 0, 200, 2), (0, 198, 200, 200), (0, 0, 2, 200), (198, 0, 200, 200)]
            inner = [(10, 5, 190, 9), (10, 191, 190, 195), (5, 10, 9, 190), (191, 10, 195, 190)]
            framed = 0
            for o, i in zip(outer, inner):
                so, si = ImageStat.Stat(im.crop(o)), ImageStat.Stat(im.crop(i))
                if so.stddev[0] < 8 and abs(so.mean[0] - si.mean[0]) > 45:
                    framed += 1
            return framed >= 3
    except Exception:
        return False


def compose_tile(game_id: str, hero: str, logo: str) -> str | None:
    """Arte do jogo recortada em quadrado com o logo oficial por cima (como os blocos do console)."""
    try:
        from PIL import Image, ImageFilter
        n = TILE_SIZE
        with Image.open(hero) as h:
            h = h.convert("RGB")
            w, ht = h.size
            side = min(w, ht)
            left = int((w - side) * .5)
            top = int((ht - side) * .5)
            tile = h.crop((left, top, left + side, top + side)).resize((n, n), Image.LANCZOS)
        # sombra suave embaixo, para o logo destacar
        shade = Image.linear_gradient("L").resize((n, n)).point(lambda v: int(v * .62))
        tile = Image.composite(Image.new("RGB", (n, n), (0, 0, 0)), tile, shade)
        with Image.open(logo) as lg:
            lg = lg.convert("RGBA")
            box = lg.getbbox()
            if box:
                lg = lg.crop(box)
            scale = min(n * .80 / lg.width, n * .34 / lg.height)
            lg = lg.resize((max(1, int(lg.width * scale)), max(1, int(lg.height * scale))), Image.LANCZOS)
            glow = Image.new("RGBA", lg.size, (0, 0, 0, 0))
            glow.putalpha(lg.getchannel("A").filter(ImageFilter.GaussianBlur(8)).point(lambda v: int(v * .55)))
            x = (n - lg.width) // 2
            y = int(n * .74 - lg.height / 2)
            tile = tile.convert("RGBA")
            tile.alpha_composite(glow, (x, y + 3))
            tile.alpha_composite(lg, (x, y))
        out = _tile_out(game_id, f"c|{hero}|{logo}")
        tile.convert("RGB").save(out, "JPEG", quality=90)
        return str(out)
    except Exception as e:
        log.warning("tile %s: %s", game_id, e)
        return None


def compose_fit(game_id: str, cover: str) -> str | None:
    """Capa inteira no centro, sobre a própria capa desfocada (nada é cortado)."""
    try:
        from PIL import Image, ImageEnhance, ImageFilter
        n = TILE_SIZE
        with Image.open(cover) as c:
            c = c.convert("RGB")
            k = max(n / c.width, n / c.height)
            bg = c.resize((int(c.width * k) + 1, int(c.height * k) + 1), Image.LANCZOS)
            bg = bg.crop(((bg.width - n) // 2, (bg.height - n) // 2, (bg.width - n) // 2 + n, (bg.height - n) // 2 + n))
            bg = ImageEnhance.Brightness(bg.filter(ImageFilter.GaussianBlur(28))).enhance(.55)
            k = min(n / c.width, n / c.height)
            fg = c.resize((max(1, int(c.width * k)), max(1, int(c.height * k))), Image.LANCZOS)
            bg.paste(fg, ((n - fg.width) // 2, (n - fg.height) // 2))
        out = _tile_out(game_id, f"f|{cover}")
        bg.save(out, "JPEG", quality=90)
        return str(out)
    except Exception as e:
        log.warning("tile %s: %s", game_id, e)
        return None


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
