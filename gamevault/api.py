"""Funções chamadas pela interface (window.pywebview.api.*)."""
import os
import subprocess
from pathlib import Path

import webview

from .paths import norm


class Api:
    def __init__(self, library):
        self._lib = library
        self._window = None

    def _bind(self, window):
        self._window = window

    # --- leitura ---------------------------------------------------------------
    def library(self):
        return self._lib.snapshot()

    def status(self):
        return self._lib.status()

    # --- pastas ----------------------------------------------------------------
    def pick_folder(self):
        res = self._window.create_file_dialog(webview.FileDialog.FOLDER)
        return res[0] if res else None

    def add_folder(self, path, mode="auto"):
        if not path or not os.path.isdir(path):
            return {"ok": False, "error": "Pasta inválida."}
        folders = self._lib.store.folders
        if any(norm(f["path"]) == norm(path) for f in folders):
            return {"ok": False, "error": "Essa pasta já está na biblioteca."}
        folders.append({"path": path, "mode": mode})
        self._lib.store.save()
        self._lib.rescan_async()
        return {"ok": True}

    def remove_folder(self, path):
        st = self._lib.store
        st.data["folders"] = [f for f in st.folders if norm(f["path"]) != norm(path)]
        st.save()
        self._lib.rescan_async()
        return {"ok": True}

    def set_folder_mode(self, path, mode):
        for f in self._lib.store.folders:
            if norm(f["path"]) == norm(path):
                f["mode"] = mode
        self._lib.store.save()
        self._lib.rescan_async()
        return {"ok": True}

    def rescan(self, force_art=False):
        return self._lib.rescan_async(force_art=force_art)

    # --- jogos -----------------------------------------------------------------
    def launch(self, gid, alt=False):
        res = self._lib.launch(gid, alt)
        if res.get("ok") and self._lib.store.settings.get("minimize_on_launch") and self._window:
            try:
                self._window.minimize()
            except Exception:
                pass
        return res

    def stop_game(self, gid):
        return self._lib.tracker.kill(gid)

    def open_folder(self, gid):
        g = self._lib.store.games.get(gid)
        if g and g.get("root") and os.path.isdir(g["root"]):
            exe = g.get("exe") or g.get("exe_auto")
            if exe and os.path.isfile(exe):
                subprocess.Popen(["explorer", "/select,", exe])
            else:
                os.startfile(g["root"])
            return True
        return False

    def update_game(self, gid, fields):
        g = self._lib.store.games.get(gid)
        if not g:
            return False
        allowed = {"name", "kind", "exe", "args", "favorite", "hidden", "notes", "platform_user"}
        for k, v in (fields or {}).items():
            if k not in allowed:
                continue
            if v in ("", None) and k in ("name", "kind", "exe"):
                g.pop(k, None)
            else:
                g[k] = v
        if "playtime_hours" in (fields or {}):
            try:
                g["playtime"] = max(0.0, float(fields["playtime_hours"]) * 3600)
            except (TypeError, ValueError):
                pass
        self._lib.store.save()
        return True

    def pick_exe(self, gid=None):
        g = self._lib.store.games.get(gid) if gid else None
        start = g.get("root") if g else ""
        res = self._window.create_file_dialog(
            webview.FileDialog.OPEN, directory=start or "",
            file_types=("Executáveis (*.exe;*.bat;*.cmd;*.lnk)", "Todos os arquivos (*.*)"))
        return res[0] if res else None

    def add_game_exe(self, kind="auto"):
        exe = self.pick_exe()
        if not exe:
            return None
        return self._lib.add_manual(exe, kind)

    def remove_game(self, gid):
        self._lib.remove_game(gid)
        return True

    def restore_removed(self):
        self._lib.store.data["excluded"] = []
        self._lib.store.save()
        self._lib.rescan_async()
        return True

    # --- capas -----------------------------------------------------------------
    def art_candidates(self, gid):
        return self._lib.art_candidates(gid)

    def set_art(self, gid, kind, src):
        return self._lib.set_art(gid, kind, src)

    def pick_art_file(self, gid, kind):
        g = self._lib.store.games.get(gid) or {}
        res = self._window.create_file_dialog(
            webview.FileDialog.OPEN, directory=g.get("root") or "",
            file_types=("Imagens (*.png;*.jpg;*.jpeg;*.webp;*.bmp)", "Todos os arquivos (*.*)"))
        if not res:
            return False
        return self._lib.set_art(gid, kind, res[0])

    def refresh_art(self, gid=None):
        if gid:
            g = self._lib.store.games.get(gid)
            if g:
                g.pop("art_checked", None)
                g.pop("exe_icon", None)
            self._lib.resolve_art_async(force=True, only=gid)
        else:
            self._lib.resolve_art_async(force=True)
        return True

    # --- atualizações ---------------------------------------------------------
    def update_info(self):
        return self._lib.updater.info()

    def check_updates(self):
        return self._lib.updater.check(auto=False)

    def install_update(self):
        res = self._lib.updater.install()
        if not res.get("ok") and res.get("url"):
            os.startfile(res["url"])
        return res

    # --- configurações ---------------------------------------------------------
    def save_settings(self, settings):
        st = self._lib.store.settings
        before_import = (st.get("import_steam"), st.get("import_epic"))
        for k, v in (settings or {}).items():
            if k in st:
                st[k] = v
        self._lib.store.save()
        if before_import != (st.get("import_steam"), st.get("import_epic")):
            self._lib.rescan_async()
        return True

    def open_data_folder(self):
        from .paths import data_dir
        os.startfile(str(data_dir()))
        return True

    def open_url(self, url):
        if isinstance(url, str) and url.startswith("https://"):
            os.startfile(url)
        return True
