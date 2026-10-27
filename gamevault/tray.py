"""Ícone na bandeja do sistema (perto do relógio) para o app continuar rodando ao fechar a janela."""
import threading

from PIL import Image
import pystray

from . import APP_NAME
from .i18n import tr
from .paths import UI_DIR


class Tray:
    def __init__(self, on_open, on_quit, lang="pt"):
        self.lang = lang
        self._on_open = on_open
        self._on_quit = on_quit
        self._notified = False
        try:
            image = Image.open(UI_DIR / "icon.png")
        except OSError:
            image = Image.new("RGBA", (64, 64), (232, 163, 61, 255))
        menu = pystray.Menu(
            pystray.MenuItem(tr("Abrir {app}", lang, app=APP_NAME), lambda: self._on_open(), default=True),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(tr("Sair", lang), lambda: self._on_quit()),
        )
        self.icon = pystray.Icon("lzlauncher", image, APP_NAME, menu)

    def start(self):
        threading.Thread(target=self.icon.run, name="tray", daemon=True).start()

    def notify_once(self):
        if self._notified:
            return
        self._notified = True
        try:
            self.icon.notify(tr("O {app} continua aberto aqui na bandeja. Clique duas vezes no ícone para voltar.",
                                self.lang, app=APP_NAME), APP_NAME)
        except Exception:
            pass

    def notify(self, text: str):
        try:
            self.icon.notify(text, APP_NAME)
        except Exception:
            pass

    def stop(self):
        try:
            self.icon.stop()
        except Exception:
            pass
