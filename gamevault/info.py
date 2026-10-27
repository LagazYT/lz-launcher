"""Informações dos jogos: descrição, gênero, desenvolvedora, lançamento e nota do Metacritic.

Fontes: loja Steam (jogos com appid) e Wikipédia + Wikidata (ports e jogos fora da Steam).
O texto vem no idioma escolhido (pt / en / es), com o inglês como reserva.
"""
import html
import logging
import re

import requests

from .art import _get, _norm_title

log = logging.getLogger("gamevault.info")
STEAM_LANG = {"pt": "brazilian", "en": "english", "es": "latam"}
METACRITIC_QID = "Q150248"


class NetError(Exception):
    """Falha de rede ou limite de consultas: tentar de novo mais tarde."""


def _req(url, **kw):
    r = _get(url, **kw)
    if r is None or r.status_code >= 500 or r.status_code == 429:
        raise NetError(url)
    return r


def _clean_html(s: str) -> str:
    s = re.sub(r"<br\s*/?>", "\n", s or "")
    s = re.sub(r"<[^>]+>", "", s)
    return html.unescape(s).strip()


def from_steam(appid: int, lang: str) -> dict | None:
    r = _req("https://store.steampowered.com/api/appdetails",
             params={"appids": appid, "l": STEAM_LANG.get(lang, "english"), "cc": "br"})
    try:
        data = r.json()[str(appid)]
        if not data.get("success"):
            return None
        d = data["data"]
    except Exception:
        return None
    year = None
    m = re.search(r"(19|20)\d{2}", (d.get("release_date") or {}).get("date", ""))
    if m:
        year = int(m.group(0))
    meta = d.get("metacritic") or {}
    return {
        "description": _clean_html(d.get("short_description")),
        "genres": [g["description"] for g in d.get("genres", [])][:4],
        "developers": d.get("developers", [])[:3],
        "publishers": d.get("publishers", [])[:3],
        "year": year,
        "release": (d.get("release_date") or {}).get("date"),
        "metacritic": meta.get("score"),
        "metacritic_url": meta.get("url"),
        "source": "Steam",
    }


def _wiki_find(name: str) -> tuple[str, str] | None:
    """Acha a página do jogo na Wikipédia em inglês e devolve (título, item do Wikidata)."""
    # uma consulta só: busca + item do Wikidata de cada resultado
    r = _req("https://en.wikipedia.org/w/api.php", params={
        "action": "query", "generator": "search", "gsrsearch": f"{name} video game", "gsrlimit": 5,
        "prop": "pageprops", "ppprop": "wikibase_item", "format": "json"})
    try:
        pages = sorted(r.json()["query"]["pages"].values(), key=lambda p: p.get("index", 99))
    except Exception:
        return None
    target = _norm_title(name)
    pages.sort(key=lambda p: 0 if _norm_title(re.sub(r"\(.*?\)", "", p["title"])) == target else 1)
    for page in pages[:3]:
        title = page["title"]
        page_norm = _norm_title(re.sub(r"\(.*?\)", "", title))
        if not (page_norm == target or target in page_norm or page_norm in target):
            continue
        qid = (page.get("pageprops") or {}).get("wikibase_item")
        if qid:
            return title, qid
    return None


def _claim_ids(claims: dict, prop: str) -> list:
    out = []
    for c in claims.get(prop, []):
        try:
            out.append(c["mainsnak"]["datavalue"]["value"]["id"])
        except (KeyError, TypeError):
            pass
    return out


def from_wikipedia(name: str, lang: str) -> dict | None:
    found = _wiki_find(name)
    if not found:
        return None
    en_title, qid = found
    r = _req("https://www.wikidata.org/w/api.php", params={
        "action": "wbgetentities", "ids": qid, "props": "claims|sitelinks", "format": "json"})
    try:
        ent = r.json()["entities"][qid]
    except Exception:
        return None
    claims = ent.get("claims", {})
    # descrição no idioma escolhido, senão em inglês
    sitelinks = ent.get("sitelinks", {})
    desc, page_url = None, None
    for code in ([lang] if lang != "en" else []) + ["en"]:
        title = (sitelinks.get(f"{code}wiki") or {}).get("title") or (en_title if code == "en" else None)
        if not title:
            continue
        s = _req(f"https://{code}.wikipedia.org/api/rest_v1/page/summary/" + requests.utils.quote(title.replace(" ", "_")))
        try:
            js = s.json()
            desc = (js.get("extract") or "").strip()
            page_url = (js.get("content_urls") or {}).get("desktop", {}).get("page")
        except Exception:
            desc = None
        if desc:
            break
    # ano de lançamento
    year = None
    for c in claims.get("P577", []):
        try:
            y = int(c["mainsnak"]["datavalue"]["value"]["time"][1:5])
            year = y if year is None else min(year, y)
        except (KeyError, TypeError, ValueError):
            pass
    # Metacritic (P444 com qualificador P447 = Metacritic)
    meta = None
    for c in claims.get("P444", []):
        try:
            by = [q["datavalue"]["value"]["id"] for q in c.get("qualifiers", {}).get("P447", [])]
            if METACRITIC_QID in by:
                val = c["mainsnak"]["datavalue"]["value"]
                m = re.match(r"(\d+)\s*/\s*100", val)
                if m:
                    meta = max(meta or 0, int(m.group(1)))
        except (KeyError, TypeError):
            pass
    ids = {"developers": _claim_ids(claims, "P178")[:3], "publishers": _claim_ids(claims, "P123")[:3],
           "genres": _claim_ids(claims, "P136")[:4]}
    labels = {}
    all_ids = sorted({i for v in ids.values() for i in v})
    if all_ids:
        lr = _req("https://www.wikidata.org/w/api.php", params={
            "action": "wbgetentities", "ids": "|".join(all_ids[:50]), "props": "labels",
            "languages": f"{lang}|en", "format": "json"})
        try:
            for i, e in lr.json()["entities"].items():
                lab = e.get("labels", {})
                labels[i] = (lab.get(lang) or lab.get("en") or {}).get("value")
        except Exception:
            pass

    def names(key):
        out = [labels.get(i) for i in ids[key]]
        return [x[:1].upper() + x[1:] for x in out if x]

    return {
        "description": desc or "",
        "genres": names("genres"),
        "developers": names("developers"),
        "publishers": names("publishers"),
        "year": year,
        "release": str(year) if year else None,
        "metacritic": meta,
        "metacritic_url": None,
        "wiki_url": page_url,
        "source": "Wikipédia",
    }


def steam_trailer(appid: int) -> str | None:
    """Link do trailer da loja Steam (streaming HLS, que o WebView2 toca direto)."""
    r = _get("https://store.steampowered.com/api/appdetails", params={"appids": appid, "filters": "movies"})
    try:
        movies = r.json()[str(appid)]["data"].get("movies") or []
    except Exception:
        return None
    for m in movies:
        url = m.get("hls_h264") or (m.get("mp4") or {}).get("max") or (m.get("webm") or {}).get("max")
        if url:
            return url
    return None


def fetch_info(name: str, steam_appid: int | None, lang: str) -> dict | None:
    info = None
    net_error = False
    if steam_appid:
        try:
            info = from_steam(int(steam_appid), lang)
        except NetError:
            net_error = True
        except Exception as e:
            log.debug("steam info %s: %s", name, e)
    if not info or not info.get("description"):
        try:
            wiki = from_wikipedia(name, lang)
        except NetError:
            net_error = True
            wiki = None
        except Exception as e:
            log.debug("wiki info %s: %s", name, e)
            wiki = None
        if wiki:
            if info:  # completa o que faltou na Steam
                for k, v in wiki.items():
                    if not info.get(k):
                        info[k] = v
            else:
                info = wiki
    if info:
        info["lang"] = lang
    elif net_error:
        return {"_net_error": True}
    return info
