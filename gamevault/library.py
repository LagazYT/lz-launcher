"""Núcleo da biblioteca: varredura, mesclagem, capas, execução dos jogos."""
import hashlib
import logging
import os
import subprocess
import threading
import time
from pathlib import Path

from . import achievements as achmod
from . import art, platforms, stores
from .i18n import resolve as resolve_lang, tr
from .info import fetch_info
from .paths import norm
from .scanner import scan_folder, detect_game, game_id_for
from .store import Store
from .tracker import PlayTracker
from .updater import Updater

log = logging.getLogger("gamevault.library")

AUTO_KEYS = ("root", "folder_name", "platform", "title_id", "version", "art_local", "dump", "name_auto",
             "kind_auto", "exe_auto", "alt_exe", "exes", "images", "source", "launch_uri",
             "ext_playtime", "ext_last_played", "art_urls", "args_auto", "gog_id")
# lojas que abrem o jogo por um link próprio (steam://, uplay://, shell:AppsFolder...)
URI_SOURCES = ("steam", "epic", "ubisoft", "xbox")
INFO_RETRY = 7 * 86400
ACH_REFRESH = 14 * 86400   # a lista oficial é buscada de novo a cada 14 dias
IMG_EXT = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif")


class Library:
    def __init__(self):
        self.store = Store()
        self.tracker = PlayTracker(self)
        self.updater = Updater(self)
        self.scanning = False
        self.scan_message = ""
        self.art_busy = False
        self._art_lock = threading.Lock()
        self._local_tokens: dict[str, str] = {}
        self.events: list[dict] = []   # avisos do programa para a interface (lidos no status)
        self.tv_active = False         # a interface está no Modo TV
        self._trailers: dict[str, str | None] = {}
        self._ach_watch: dict[str, dict] = {}   # arquivos de conquistas observados por jogo
        self.on_trophy = None                   # aviso por cima do jogo (definido pelo main)
        self.pad = None                # PadWatcher (controle XInput)

    def lang(self) -> str:
        return resolve_lang(self.store.settings.get("language"))

    # ------------------------------------------------------------------ varredura
    def start(self):
        self.tracker.start()
        self.updater.start()
        threading.Thread(target=self._ach_loop, name="achievements", daemon=True).start()
        self.rescan_async()

    def rescan_async(self, force_art=False):
        if self.scanning:
            return False
        threading.Thread(target=self._rescan, args=(force_art,), daemon=True).start()
        return True

    def _rescan(self, force_art=False):
        self.scanning = True
        try:
            lang = self.lang()
            self.scan_message = tr("Procurando jogos...", lang)
            self.store.touch()
            st = self.store.settings
            found: list[dict] = []
            if st.get("import_steam"):
                self.scan_message = tr("Lendo biblioteca da Steam...", lang)
                try:
                    found += platforms.find_steam_games()
                except Exception as e:
                    log.warning("steam: %s", e)
            if st.get("import_epic"):
                try:
                    found += platforms.find_epic_games()
                except Exception as e:
                    log.warning("epic: %s", e)
            for key, (label, finder) in stores.STORES.items():
                if not st.get(key, True):
                    continue
                self.scan_message = tr("Lendo jogos da {store}...", lang, store=label)
                self.store.touch()
                try:
                    found += finder()
                except Exception as e:
                    log.warning("%s: %s", label, e)
            platform_roots = {norm(g["root"]) for g in found}
            for folder in list(self.store.folders):
                self.scan_message = tr("Escaneando {path}...", lang, path=folder["path"])
                self.store.touch()
                try:
                    for g in scan_folder(folder["path"], folder.get("mode", "auto")):
                        if norm(g["root"]) in platform_roots:
                            continue
                        g["source"] = "folder"
                        g["folder"] = folder["path"]
                        g["id"] = game_id_for(g["root"])
                        found.append(g)
                except Exception as e:
                    log.exception("scan %s: %s", folder, e)
            self._merge(found)
        finally:
            self.scanning = False
            self.scan_message = ""
            self.store.save()
        self.resolve_art_async(force=force_art)

    def _merge(self, found: list):
        now = time.time()
        excluded = set(self.store.data.setdefault("excluded", []))
        with self.store.lock:
            games = self.store.games
            seen = set()
            for g in found:
                gid = g["id"]
                if gid in excluded:
                    continue
                seen.add(gid)
                rec = games.get(gid) or {"added": now, "playtime": 0.0, "sessions": 0}
                for k in AUTO_KEYS:
                    if k in g:
                        rec[k] = g[k]
                if g.get("steam_appid"):
                    rec["steam_appid"] = g["steam_appid"]
                rec["missing"] = False
                games[gid] = rec
            for gid, rec in games.items():
                if gid in seen:
                    continue
                if rec.get("source") == "manual":
                    rec["missing"] = not Path(rec.get("exe") or rec.get("exe_auto") or "").exists()
                else:
                    rec["missing"] = True

    # ------------------------------------------------------------------ capas
    def resolve_art_async(self, force=False, only: str | None = None):
        threading.Thread(target=self._resolve_art, args=(force, only), daemon=True).start()

    def _resolve_art(self, force=False, only=None):
        with self._art_lock:
            self.art_busy = True
            try:
                ids = [only] if only else list(self.store.games)
                for gid in ids:
                    g = self.store.games.get(gid)
                    if not g or g.get("missing"):
                        continue
                    try:
                        self._resolve_one(gid, g, force)
                    except Exception as e:
                        log.warning("art %s: %s", gid, e)
                    try:
                        self._resolve_info(g, force)
                    except Exception as e:
                        log.warning("info %s: %s", gid, e)
                    try:
                        self._resolve_tile(gid, g, force)
                    except Exception as e:
                        log.warning("tile %s: %s", gid, e)
                    try:
                        self._resolve_ach(gid, g, force)
                    except Exception as e:
                        log.warning("ach %s: %s", gid, e)
                    self.store.touch()
            finally:
                self.art_busy = False
                self.store.save()

    def _resolve_one(self, gid, g, force):
        exe = g.get("exe") or g.get("exe_auto")
        if exe and Path(exe).is_file() and not g.get("exe_icon"):
            g["exe_icon"] = art.exe_icon(exe, gid)
        st = self.store.settings
        if not st.get("online_art"):
            return
        if g.get("art_checked") and not force:
            return
        online = {} if force else dict(g.get("art_online") or {})
        local = g.get("art_local") or {}
        name = g.get("name") or g.get("name_auto") or ""
        appid = g.get("steam_appid")
        kind = g.get("kind") or g.get("kind_auto")
        gog_id = (g.get("art_urls") or {}).get("gog")
        if gog_id and (not local.get("cover") and not online.get("cover")):
            urls = art.gog_art_urls(gog_id)
            if urls.get("cover"):
                online["cover"] = art.download(urls["cover"], gid, "cover")
                online["source"] = "GOG"
            if urls.get("hero") and not local.get("hero") and not online.get("hero"):
                online["hero"] = art.download(urls["hero"], gid, "hero")
        if not appid and kind == "normal" and g.get("source") != "steam":
            appid = art.steam_match(name)
            if appid:
                g["steam_appid_guess"] = appid
        if appid:
            if not local.get("cover") and not online.get("cover"):
                online["cover"] = art.steam_download(appid, gid, "cover") or art.steam_download(appid, gid, "header")
                online["source"] = "Steam"
            if not local.get("hero") and not online.get("hero"):
                online["hero"] = art.steam_download(appid, gid, "hero")
        key = st.get("steamgriddb_key", "").strip()
        if not local.get("cover") and not online.get("cover") and key:
            hits = art.sgdb_search(name, key)
            if hits:
                urls = art.sgdb_images(hits[0]["id"], key, "cover")
                if urls:
                    online["cover"] = art.download(urls[0], gid, "cover")
                    online["source"] = "SteamGridDB"
                if not local.get("hero") and not online.get("hero"):
                    heroes = art.sgdb_images(hits[0]["id"], key, "hero")
                    if heroes:
                        online["hero"] = art.download(heroes[0], gid, "hero")
        if not local.get("cover") and not online.get("cover"):
            wb = art.wikipedia_boxart(name)
            # só usa a imagem da Wikipédia se for uma capa vertical, ou se não houver arte local
            if wb and (wb["portrait"] or not (local.get("icon") or local.get("logo"))):
                online["cover"] = art.download(wb["url"], gid, "cover")
                online["source"] = "Wikipédia"
        g["art_online"] = {k: v for k, v in online.items() if v}
        g["art_checked"] = time.time()

    def _resolve_info(self, g: dict, force=False):
        """Descrição, gênero, desenvolvedora, ano e Metacritic no idioma atual."""
        if not self.store.settings.get("online_art", True):
            return
        lang = self.lang()
        info = g.get("info") or {}
        if not force and info.get("lang") == lang and (info.get("description") or info.get("genres")):
            return
        fail = g.get("info_fail") or {}
        if not force and fail.get("lang") == lang and time.time() - fail.get("t", 0) < fail.get("retry", INFO_RETRY):
            return
        name = g.get("name") or g.get("name_auto") or ""
        appid = g.get("steam_appid") or g.get("steam_appid_guess")
        new = fetch_info(name, appid, lang)
        if new and (new.get("description") or new.get("genres")):
            g["info"] = new
            g.pop("info_fail", None)
        elif new and new.get("_net_error"):
            g["info_fail"] = {"lang": lang, "t": time.time(), "retry": 3600}  # sem internet: tenta em 1 hora
        else:
            g["info_fail"] = {"lang": lang, "t": time.time()}
        time.sleep(0.4)  # não sobrecarrega a Steam/Wikipédia

    # ------------------------------------------------------------------ bloco quadrado (tema Xbox)
    TILE_VERSION = 1

    def _resolve_tile(self, gid: str, g: dict, force=False):
        """Imagem quadrada do jogo: arte oficial quadrada do PS4, arte quadrada do SteamGridDB,
        arte + logo oficial montados ou, por último, a capa inteira sobre a capa desfocada."""
        local = g.get("art_local") or {}
        cover = self.image_path(gid, "cover")
        sources = "|".join(str(x) for x in (local.get("icon"), cover, self.image_path(gid, "hero"), local.get("logo")))
        cur = g.get("tile")
        if not force and cur and os.path.isfile(cur) and g.get("tile_v") == self.TILE_VERSION and g.get("tile_src") == sources:
            return
        if not force and not cur and g.get("tile_v") == self.TILE_VERSION and g.get("tile_src") == sources:
            return
        tile = None
        icon = local.get("icon")
        if icon and os.path.isfile(icon) and art.is_square(icon):  # PS4/PS5: icon0.png é a arte oficial do bloco
            tile = icon
        key = self.store.settings.get("steamgriddb_key", "").strip()
        name = g.get("name") or g.get("name_auto") or ""
        appid = g.get("steam_appid") or g.get("steam_appid_guess") or (g.get("ach") or {}).get("appid")
        sgdb_id = None
        if not tile and key and self.store.settings.get("online_art", True):
            sgdb_id = art.sgdb_game_id(key, appid, name)
            if sgdb_id:
                for url in art.sgdb_square(key, sgdb_id)[:5]:
                    tile = art.download(url, gid, "tile")
                    if tile and art.has_frame(tile):  # cartaz com moldura branca: tenta a próxima
                        tile = None
                    if tile:
                        break
        if not tile:
            hero = self.image_path(gid, "hero")
            logo = local.get("logo") if local.get("logo") and "librarycache" in local.get("logo", "").lower() else None
            if hero and not logo and sgdb_id:
                for url in art.sgdb_official_logo(key, sgdb_id)[:2]:
                    logo = art.download(url, gid, "logo")
                    if logo:
                        break
            if hero and logo and os.path.isfile(logo):
                tile = art.compose_tile(gid, hero, logo)
        if not tile and cover:
            tile = art.compose_fit(gid, cover)
        g["tile"] = tile
        g["tile_v"] = self.TILE_VERSION
        g["tile_src"] = sources

    # ------------------------------------------------------------------ conquistas
    def _resolve_ach(self, gid: str, g: dict, force=False):
        lang = self.lang()
        cur = g.get("ach")
        if cur and not force and cur.get("lang") == lang and time.time() - cur.get("t", 0) < ACH_REFRESH:
            return
        if not force and not cur and g.get("ach_none_v") == achmod.VERSION and time.time() - g.get("ach_none", 0) < 3 * 86400:
            return
        new = achmod.build_list(g, gid, lang, self.store.settings.get("steam_api_key", "").strip())
        if not new:
            if not achmod.online():
                return  # sem internet: tenta de novo na próxima busca
            g["ach_none"] = time.time()
            g["ach_none_v"] = achmod.VERSION
            return
        g.pop("ach_none", None)
        g.pop("ach_none_v", None)
        g["ach"] = new
        # o que já estava desbloqueado entra no histórico sem aviso
        files = achmod.collect_files(achmod.watch_targets(g, new))
        known = g.setdefault("ach_unlocked", {})
        for k, ts in achmod.read_unlocks(g, new, files).items():
            known.setdefault(k, ts)
        self._ach_watch.pop(gid, None)

    def refresh_achievements(self, gid: str | None = None):
        def run():
            for i in ([gid] if gid else list(self.store.games)):
                g = self.store.games.get(i)
                if g and not g.get("missing"):
                    try:
                        self._resolve_ach(i, g, force=True)
                    except Exception as e:
                        log.warning("ach %s: %s", i, e)
                    self.store.touch()
            self.store.save()
        threading.Thread(target=run, daemon=True).start()

    def _ach_loop(self):
        """Vigia os arquivos de conquistas e avisa na hora em que uma nova é desbloqueada."""
        time.sleep(8)
        while True:
            try:
                self._ach_tick()
            except Exception as e:
                log.warning("ach loop: %s", e)
            time.sleep(3)

    def _ach_tick(self):
        now = time.time()
        fresh = []
        for gid, g in list(self.store.games.items()):
            ach = g.get("ach")
            if not ach or g.get("missing"):
                continue
            w = self._ach_watch.get(gid)
            if not w or now - w["t"] > 300:
                w = {"targets": achmod.watch_targets(g, ach), "t": now, "sig": w["sig"] if w else None}
                self._ach_watch[gid] = w
            files = achmod.collect_files(w["targets"])
            sig = achmod.files_signature(files)
            if sig == w["sig"]:
                continue
            first = w["sig"] is None
            w["sig"] = sig
            unlocks = achmod.read_unlocks(g, ach, files)
            known = g.setdefault("ach_unlocked", {})
            new = [k for k in unlocks if k not in known]
            for k in new:
                ts = unlocks[k]
                known[k] = ts if ts > 1_000_000_000 else int(now)
            if not new:
                continue
            by_id = {a["id"]: a for a in ach["list"]}
            for k in new:
                # na primeira leitura só avisa o que foi desbloqueado nos últimos 10 minutos
                if first and now - known[k] > 600:
                    continue
                a = by_id.get(k, {})
                fresh.append({"game_id": gid, "game": g.get("name") or g.get("name_auto"), "kind": ach["kind"],
                              "id": k, "name": a.get("name") or k, "desc": a.get("desc") or "", "type": a.get("type"),
                              "rarity": a.get("rarity"), "icon": self.icon_url(a.get("icon")),
                              "progress": [len([x for x in known if x in by_id]), len(by_id)]})
        if fresh:
            self.store.save()
            for item in fresh:
                self.push_event("trophy", **item)
            if self.on_trophy:
                try:
                    self.on_trophy(fresh)
                except Exception as e:
                    log.warning("overlay: %s", e)

    def icon_url(self, icon: str | None) -> str | None:
        if not icon:
            return None
        if icon.startswith(("http://", "https://")):
            return achmod.fix_icon_url(icon)
        return "/local/" + self.local_token(icon) if os.path.isfile(icon) else None

    def ach_summary(self, g: dict) -> dict | None:
        ach = g.get("ach")
        if not ach:
            return None
        ids = {a["id"]: a for a in ach["list"]}
        unlocked = [k for k in (g.get("ach_unlocked") or {}) if k in ids]
        plat = any(ids[k].get("type") == "platinum" for k in unlocked)
        last = max([(g.get("ach_unlocked") or {})[k] for k in unlocked], default=None)
        return {"kind": ach["kind"], "total": len(ids), "unlocked": len(unlocked), "plat": plat, "last": last}

    def achievements(self, gid: str) -> dict | None:
        g = self.store.games.get(gid)
        if not g or not g.get("ach"):
            return None
        ach = g["ach"]
        un = g.get("ach_unlocked") or {}
        items = []
        for a in ach["list"]:
            items.append({**{k: v for k, v in a.items() if not k.startswith("_")},
                          "icon": self.icon_url(a.get("icon")), "icon_gray": self.icon_url(a.get("icon_gray")),
                          "unlocked": un.get(a["id"])})
        w = self._ach_watch.get(gid)
        try:
            detect = achmod.detect_label(achmod.collect_files(w["targets"] if w else achmod.watch_targets(g, ach)))
        except Exception:
            detect = None
        return {"kind": ach["kind"], "source": ach.get("source"), "groups": ach.get("groups"), "list": items,
                "detect": detect, **(self.ach_summary(g) or {})}

    def achievements_overview(self) -> dict:
        games, recent = [], []
        types = {"platinum": 0, "gold": 0, "silver": 0, "bronze": 0, "other": 0}
        for gid, g in self.store.games.items():
            if g.get("missing") or not g.get("ach"):
                continue
            s = self.ach_summary(g)
            games.append({"id": gid, "name": g.get("name") or g.get("name_auto"), **s})
            by_id = {a["id"]: a for a in g["ach"]["list"]}
            for k, ts in (g.get("ach_unlocked") or {}).items():
                a = by_id.get(k)
                if a:
                    t = a.get("type") if g["ach"]["kind"] == "psn" else None
                    types[t if t in types else "other"] += 1
                    recent.append({"game_id": gid, "game": g.get("name") or g.get("name_auto"), "kind": g["ach"]["kind"],
                                   "name": a.get("name"), "desc": a.get("desc"), "type": a.get("type"), "rarity": a.get("rarity"),
                                   "icon": a.get("icon"), "ts": ts})
        recent.sort(key=lambda x: x["ts"] or 0, reverse=True)
        recent = recent[:40]
        for r in recent:
            r["icon"] = self.icon_url(r["icon"])
        return {"games": games, "recent": recent, "types": types}

    def drives(self) -> list:
        """Espaço livre dos discos onde estão os jogos (cartão Armazenamento do tema PS5)."""
        import shutil
        seen, out = set(), []
        for g in self.store.games.values():
            root = g.get("root")
            if not root or g.get("missing"):
                continue
            drive = os.path.splitdrive(root)[0].upper()
            if not drive or drive in seen:
                continue
            seen.add(drive)
            try:
                u = shutil.disk_usage(drive + "\\")
            except OSError:
                continue
            out.append({"drive": drive, "total": u.total, "free": u.free,
                        "games": sum(1 for x in self.store.games.values() if (x.get("root") or "").upper().startswith(drive))})
        return sorted(out, key=lambda d: d["drive"])

    def refresh_info(self, gid: str | None = None):
        def run():
            ids = [gid] if gid else list(self.store.games)
            for i in ids:
                g = self.store.games.get(i)
                if g and not g.get("missing"):
                    try:
                        self._resolve_info(g, force=bool(gid))
                    except Exception as e:
                        log.warning("info %s: %s", i, e)
                    self.store.touch()
            self.store.save()
        threading.Thread(target=run, daemon=True).start()

    def trailer_url(self, gid: str) -> str | None:
        """Trailer do jogo na Steam (o link expira, então fica só em memória)."""
        if gid in self._trailers:
            return self._trailers[gid]
        g = self.store.games.get(gid) or {}
        appid = g.get("steam_appid") or g.get("steam_appid_guess")
        url = None
        if appid:
            from .info import steam_trailer
            try:
                url = steam_trailer(int(appid))
            except Exception:
                url = None
        self._trailers[gid] = url
        return url

    def image_path(self, gid: str, kind: str) -> str | None:
        g = self.store.games.get(gid)
        if not g:
            return None
        local = g.get("art_local") or {}
        online = g.get("art_online") or {}
        order = {
            "cover": [g.get("cover"), local.get("cover"), online.get("cover"), local.get("icon"),
                      local.get("header"), local.get("logo"), g.get("exe_icon")],
            "hero": [g.get("hero"), local.get("hero"), online.get("hero"), local.get("header")],
            "icon": [local.get("icon"), g.get("exe_icon"), local.get("logo"), local.get("cover"), online.get("cover")],
            "tile": [g.get("tile")],
        }.get(kind, [])
        for p in order:
            if p and os.path.isfile(p):
                return p
        return None

    def local_token(self, path: str) -> str:
        t = hashlib.sha1(path.encode("utf-8")).hexdigest()[:16]
        self._local_tokens[t] = path
        return t

    def local_from_token(self, token: str) -> str | None:
        return self._local_tokens.get(token)

    def art_candidates(self, gid: str) -> dict:
        g = self.store.games.get(gid)
        if not g:
            return {"local": [], "online": []}
        paths = []
        for v in list((g.get("art_local") or {}).values()) + list((g.get("art_online") or {}).values()) \
                + [g.get("exe_icon")] + list(g.get("images") or []):
            if v and isinstance(v, str) and v.lower().endswith(IMG_EXT) and os.path.isfile(v) and v not in paths:
                paths.append(v)
        dump = g.get("dump")
        if dump:
            sys_dir = Path(dump) / "sce_sys"
            if sys_dir.is_dir():
                for f in sorted(sys_dir.glob("*.png")):
                    if str(f) not in paths:
                        paths.append(str(f))
        local = []
        for p in paths[:40]:
            size = art.image_size(p)
            local.append({"token": self.local_token(p), "name": Path(p).name, "path": p,
                          "w": size[0] if size else 0, "h": size[1] if size else 0})
        name = g.get("name") or g.get("name_auto") or ""
        online = art.candidate_search(name, g.get("steam_appid") or g.get("steam_appid_guess"),
                                      self.store.settings.get("steamgriddb_key", "").strip())
        return {"local": local, "online": online}

    def set_art(self, gid: str, kind: str, src: str | None):
        """src: caminho local, token local, URL http(s) ou None para voltar ao automático."""
        g = self.store.games.get(gid)
        if not g or kind not in ("cover", "hero"):
            return False
        if not src:
            g.pop(kind, None)
        elif src.startswith(("http://", "https://")):
            p = art.download(src, gid, kind)
            if not p:
                return False
            g[kind] = p
        else:
            p = self.local_from_token(src) or src
            if not os.path.isfile(p):
                return False
            g[kind] = p
        self.store.save()
        return True

    # ------------------------------------------------------------------ execução
    def launch(self, gid: str, alt=False) -> dict:
        g = self.store.games.get(gid)
        lang = self.lang()
        if not g:
            return {"ok": False, "error": tr("Jogo não encontrado.", lang)}
        target = None
        if alt:
            target = g.get("alt_exe")
        else:
            target = g.get("exe") or (None if g.get("launch_uri") and g.get("source") in URI_SOURCES else g.get("exe_auto"))
        try:
            if not target and g.get("launch_uri") and not alt:
                os.startfile(g["launch_uri"])
            elif target:
                if not os.path.isfile(target):
                    return {"ok": False, "error": tr("Executável não existe mais:\n{path}", lang, path=target)}
                cwd = os.path.dirname(target)
                ext = os.path.splitext(target)[1].lower()
                args = (g.get("args") or ("" if g.get("exe") else g.get("args_auto")) or "").strip()
                if ext in (".exe", ".com"):
                    cmd = subprocess.list2cmdline([target]) + (" " + args if args else "")
                    flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
                    subprocess.Popen(cmd, cwd=cwd, creationflags=flags, close_fds=True)
                else:
                    os.startfile(target, cwd=cwd) if args == "" else os.startfile(target, arguments=args, cwd=cwd)
            else:
                return {"ok": False, "error": tr("Nenhum executável definido para este jogo. Use \"Editar\" para escolher o .exe.", lang)}
        except OSError as e:
            return {"ok": False, "error": str(e)}
        self.tracker.mark_launched(gid)
        g["last_launched"] = time.time()
        self.store.save()
        return {"ok": True}

    def add_manual(self, exe: str, kind: str = "auto") -> str | None:
        p = Path(exe)
        if not p.is_file():
            return None
        info = detect_game(p.parent, kind) or {
            "root": str(p.parent), "folder_name": p.parent.name, "platform": "PC", "art_local": {},
            "name_auto": p.stem, "kind_auto": "normal" if kind == "auto" else kind, "exes": [str(p)],
        }
        info["exe_auto"] = str(p)
        info["source"] = "manual"
        gid = game_id_for(info["root"])
        with self.store.lock:
            rec = self.store.games.get(gid) or {"added": time.time(), "playtime": 0.0, "sessions": 0}
            for k in AUTO_KEYS:
                if k in info:
                    rec[k] = info[k]
            rec["exe"] = str(p)
            rec["missing"] = False
            self.store.games[gid] = rec
            excl = self.store.data.setdefault("excluded", [])
            if gid in excl:
                excl.remove(gid)
        self.store.save()
        self.resolve_art_async(only=gid)
        return gid

    def remove_game(self, gid: str):
        with self.store.lock:
            self.store.games.pop(gid, None)
            excl = self.store.data.setdefault("excluded", [])
            if gid not in excl:
                excl.append(gid)
        self.store.save()

    # ------------------------------------------------------------------ interface
    def to_ui(self, gid: str, g: dict) -> dict:
        def ver(kind):
            p = self.image_path(gid, kind)
            if not p:
                return None
            try:
                v = int(os.path.getmtime(p))
            except OSError:
                v = 0
            return f"/img/{gid}/{kind}?v={hashlib.md5((p + str(v)).encode()).hexdigest()[:8]}"

        exe = g.get("exe") or g.get("exe_auto")
        return {
            "id": gid,
            "name": g.get("name") or g.get("name_auto") or g.get("folder_name") or "?",
            "kind": g.get("kind") or g.get("kind_auto") or "normal",
            "platform": self._platform(g),
            "source": g.get("source") or "folder",
            "root": g.get("root"),
            "exe": exe,
            "exe_custom": bool(g.get("exe")),
            "alt_exe": g.get("alt_exe"),
            "exes": g.get("exes") or [],
            "args": g.get("args") or "",
            "launch_uri": g.get("launch_uri"),
            "title_id": g.get("title_id"),
            "version": g.get("version"),
            "playtime": max(float(g.get("playtime", 0)), float(g.get("ext_playtime") or 0)),
            "last_played": max(float(g.get("last_played") or 0), float(g.get("ext_last_played") or 0)) or None,
            "last_session": g.get("last_session"),
            "sessions": g.get("sessions", 0),
            "added": g.get("added"),
            "favorite": bool(g.get("favorite")),
            "hidden": bool(g.get("hidden")),
            "notes": g.get("notes") or "",
            "running": gid in self.tracker.running,
            "cover": ver("cover"),
            "hero": ver("hero"),
            "icon": ver("icon"),
            "tile": ver("tile"),
            "cover_custom": bool(g.get("cover")),
            "art_source": (g.get("art_online") or {}).get("source"),
            "info": g.get("info"),
            "history": g.get("history") or [],
            "ach": self.ach_summary(g),
        }

    @staticmethod
    def _platform(g: dict) -> str:
        plat = g.get("platform") or "PC"
        # jogo marcado como "Jogo de PC" pelo usuário não deve aparecer como console
        if (g.get("kind") or g.get("kind_auto")) == "normal" and plat == "Console" and not g.get("dump"):
            return "PC"
        return plat

    def snapshot(self) -> dict:
        with self.store.lock:
            games = [self.to_ui(gid, g) for gid, g in self.store.games.items() if not g.get("missing")]
        return {
            "games": games,
            "folders": self.store.folders,
            "settings": self.store.settings,
            "revision": self.store.revision,
            "lang": self.lang(),
        }

    def status(self) -> dict:
        return {
            "revision": self.store.revision,
            "scanning": self.scanning,
            "scan_message": self.scan_message,
            "art_busy": self.art_busy,
            "running": {gid: time.time() - r["start"] for gid, r in self.tracker.running.items()},
            "update": self.updater.info(),
            "events": self.pop_events(),
            "pad": {"connected": bool(self.pad and self.pad.connected),
                    "battery": self.pad.battery if self.pad else None},
        }

    def push_event(self, kind: str, **data):
        self.events.append({"type": kind, **data})
        del self.events[:-20]

    def pop_events(self) -> list:
        out, self.events = self.events, []
        return out
