"""Funções chamadas pela interface (window.pywebview.api.*)."""
import os
import threading
import subprocess
from pathlib import Path

import webview

from .i18n import tr

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
            return {"ok": False, "error": tr("Pasta inválida.", self._lib.lang())}
        folders = self._lib.store.folders
        if any(norm(f["path"]) == norm(path) for f in folders):
            return {"ok": False, "error": tr("Essa pasta já está na biblioteca.", self._lib.lang())}
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

    # --- preferências da interface -------------------------------------------
    def ui_prefs(self):
        return dict(self._lib.store.settings.get("ui") or {})

    def set_ui_pref(self, key, value):
        if not isinstance(key, str) or len(key) > 80 or not isinstance(value, (str, int, float, bool)):
            return False
        prefs = self._lib.store.settings.setdefault("ui", {})
        if prefs.get(key) == value:
            return True
        prefs[key] = value
        self._lib.store.save(bump=False)  # não precisa recarregar a interface
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
        import_keys = [k for k in st if k.startswith("import_")]
        before_import = [st.get(k) for k in import_keys]
        before_lang = self._lib.lang()
        for k, v in (settings or {}).items():
            if k in st:
                st[k] = v
        self._lib.store.save()
        if before_import != [st.get(k) for k in import_keys]:
            self._lib.rescan_async()
        if self._lib.lang() != before_lang:
            self._lib.refresh_info()  # descrições dos jogos no idioma novo
        if "start_with_windows" in (settings or {}):
            from .system import set_start_with_windows
            if not set_start_with_windows(bool(st["start_with_windows"])):
                st["start_with_windows"] = False
                self._lib.store.save()
                return False
        return True

    def refresh_info(self, gid=None):
        self._lib.refresh_info(gid)
        return True

    # --- Modo TV ---------------------------------------------------------------
    def set_tv(self, on):
        """A interface entrou/saiu do Modo TV: tela cheia e lembra o estado."""
        self._lib.tv_active = bool(on)
        return self.set_fullscreen(on)

    def get_trailer(self, gid):
        return self._lib.trailer_url(gid)

    def _fix_fullscreen_edges(self):
        """Esconde a moldura de 1 px que a janela mantém em tela cheia."""
        import time
        from .system import cover_monitor
        time.sleep(0.35)  # espera o pywebview terminar de entrar em tela cheia
        hwnd = None
        try:
            hwnd = self._window.native.Handle.ToInt32()
        except Exception:
            import ctypes
            from . import APP_NAME
            hwnd = ctypes.windll.user32.FindWindowW(None, APP_NAME)
        if self._fullscreen:
            cover_monitor(hwnd)

    def system_volume(self, action):
        from .system import volume
        return volume(action)

    def system_power(self, action):
        from .system import power
        if action not in ("sleep", "restart", "shutdown"):
            return False
        return power(action)

    def quit_app(self):
        if getattr(self, "_quit", None):
            threading.Thread(target=self._quit, daemon=True).start()
            return True
        return False

    def set_fullscreen(self, on):
        w = self._window
        if not w:
            return False
        try:
            if bool(on) != getattr(self, "_fullscreen", False):
                w.toggle_fullscreen()
                self._fullscreen = bool(on)
                if on:
                    threading.Thread(target=self._fix_fullscreen_edges, daemon=True).start()
        except Exception:
            return False
        return True

    def open_data_folder(self):
        from .paths import data_dir
        os.startfile(str(data_dir()))
        return True

    def open_url(self, url):
        if isinstance(url, str) and url.startswith("https://"):
            os.startfile(url)
        return True
