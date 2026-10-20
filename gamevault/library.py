"""Núcleo da biblioteca: varredura, mesclagem, capas, execução dos jogos."""
import hashlib
import logging
import os
import subprocess
import threading
import time
from pathlib import Path

from . import art, platforms
from .paths import norm
from .scanner import scan_folder, detect_game, game_id_for
from .store import Store
from .tracker import PlayTracker
from .updater import Updater

log = logging.getLogger("gamevault.library")

AUTO_KEYS = ("root", "folder_name", "platform", "title_id", "version", "art_local", "dump", "name_auto",
             "kind_auto", "exe_auto", "alt_exe", "exes", "images", "source", "launch_uri",
             "ext_playtime", "ext_last_played")
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

    # ------------------------------------------------------------------ varredura
    def start(self):
        self.tracker.start()
        self.updater.start()
        self.rescan_async()

    def rescan_async(self, force_art=False):
        if self.scanning:
            return False
        threading.Thread(target=self._rescan, args=(force_art,), daemon=True).start()
        return True

    def _rescan(self, force_art=False):
        self.scanning = True
        try:
            self.scan_message = "Procurando jogos..."
            self.store.touch()
            st = self.store.settings
            found: list[dict] = []
            if st.get("import_steam"):
                self.scan_message = "Lendo biblioteca da Steam..."
                try:
                    found += platforms.find_steam_games()
                except Exception as e:
                    log.warning("steam: %s", e)
            if st.get("import_epic"):
                try:
                    found += platforms.find_epic_games()
                except Exception as e:
                    log.warning("epic: %s", e)
            platform_roots = {norm(g["root"]) for g in found}
            for folder in list(self.store.folders):
                self.scan_message = f"Escaneando {folder['path']}..."
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
        if not g:
            return {"ok": False, "error": "Jogo não encontrado."}
        target = None
        if alt:
            target = g.get("alt_exe")
        else:
            target = g.get("exe") or (None if g.get("launch_uri") and g.get("source") in ("steam", "epic") else g.get("exe_auto"))
        try:
            if not target and g.get("launch_uri") and not alt:
                os.startfile(g["launch_uri"])
            elif target:
                if not os.path.isfile(target):
                    return {"ok": False, "error": f"Executável não existe mais:\n{target}"}
                cwd = os.path.dirname(target)
                ext = os.path.splitext(target)[1].lower()
                args = (g.get("args") or "").strip()
                if ext in (".exe", ".com"):
                    cmd = subprocess.list2cmdline([target]) + (" " + args if args else "")
                    flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
                    subprocess.Popen(cmd, cwd=cwd, creationflags=flags, close_fds=True)
                else:
                    os.startfile(target, cwd=cwd) if args == "" else os.startfile(target, arguments=args, cwd=cwd)
            else:
                return {"ok": False, "error": "Nenhum executável definido para este jogo. Use \"Editar\" para escolher o .exe."}
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
            "cover_custom": bool(g.get("cover")),
            "art_source": (g.get("art_online") or {}).get("source"),
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
        }

    def status(self) -> dict:
        return {
            "revision": self.store.revision,
            "scanning": self.scanning,
            "scan_message": self.scan_message,
            "art_busy": self.art_busy,
            "running": {gid: time.time() - r["start"] for gid, r in self.tracker.running.items()},
            "update": self.updater.info(),
        }
