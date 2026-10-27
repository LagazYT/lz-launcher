"""Persistência da biblioteca em JSON (%APPDATA%\\LZ Launcher\\library.json)."""
import json
import os
import threading
import time

from .paths import LIBRARY_FILE, data_dir

DEFAULT_SETTINGS = {
    "import_steam": True,
    "import_epic": True,
    "import_gog": True,
    "import_ubisoft": True,
    "import_ea": True,
    "import_battlenet": True,
    "import_xbox": True,
    "language": "auto",
    "tv_on_start": False,
    "start_with_windows": False,
    "tv_return": True,
    "tv_sounds": True,
    "tv_trailers": True,
    "tv_fx": True,
    "online_art": True,
    "steamgriddb_key": "",
    "track_external": True,
    "minimize_on_launch": False,
    "close_to_tray": True,
    "theme": "sober",
    "check_updates": True,
    "auto_update": True,
    "card_size": 190,
    "sort": "name",
}


class Store:
    def __init__(self, path=LIBRARY_FILE):
        self.path = path
        self.lock = threading.RLock()
        self.data = {"version": 1, "folders": [], "settings": dict(DEFAULT_SETTINGS), "games": {}}
        self.revision = 0
        self._load()

    def _load(self):
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                text = f.read()
            # caminhos do cache gravados com o nome antigo do app (GameVault)
            new_dir = str(data_dir())
            old_dir = os.path.join(os.path.dirname(new_dir), "GameVault")
            text = text.replace(json.dumps(old_dir)[1:-1] + "\\\\", json.dumps(new_dir)[1:-1] + "\\\\")
            loaded = json.loads(text)
            self.data.update(loaded)
            settings = dict(DEFAULT_SETTINGS)
            settings.update(self.data.get("settings") or {})
            self.data["settings"] = settings
        except FileNotFoundError:
            pass
        except Exception:
            # arquivo corrompido: guarda uma cópia e começa do zero
            try:
                os.replace(self.path, str(self.path) + f".broken-{int(time.time())}")
            except OSError:
                pass

    def save(self, bump=True):
        with self.lock:
            if bump:
                self.revision += 1
            tmp = str(self.path) + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False, indent=1)
            os.replace(tmp, self.path)

    def touch(self):
        """Marca mudança para a interface recarregar."""
        with self.lock:
            self.revision += 1

    @property
    def games(self) -> dict:
        return self.data["games"]

    @property
    def folders(self) -> list:
        return self.data["folders"]

    @property
    def settings(self) -> dict:
        return self.data["settings"]
