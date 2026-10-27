"""LZ Launcher - biblioteca e launcher de jogos recompilados e jogos de PC."""
import logging
import sys
import threading

import webview

from gamevault import APP_NAME
from gamevault.api import Api
from gamevault.library import Library
from gamevault.paths import LOG_FILE
from gamevault.server import make_server
from gamevault.tray import Tray
from gamevault.i18n import tr


def main():
    logging.basicConfig(filename=LOG_FILE, level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    lib = Library()
    api = Api(lib)
    srv = make_server(lib, api)
    url = f"http://127.0.0.1:{srv.server_address[1]}/index.html?t={srv.token}"
    window = webview.create_window(APP_NAME, url, js_api=api, width=1360, height=840,
                                   min_size=(980, 620), background_color="#141518")
    api._bind(window)
    quitting = threading.Event()

    def show_window():
        window.show()
        window.restore()

    def quit_app():
        quitting.set()
        tray.stop()
        window.destroy()

    tray = Tray(on_open=show_window, on_quit=quit_app, lang=lib.lang())

    def on_closing():
        # "Fechar" com a opção ligada só esconde a janela; o app segue na bandeja
        if not quitting.is_set() and lib.store.settings.get("close_to_tray", True):
            threading.Thread(target=lambda: (window.hide(), tray.notify_once()), daemon=True).start()
            return False
        return True

    lib.updater.quit_app = quit_app
    lib.updater.on_found = lambda v: tray.notify(tr("Nova versão {version} do {app} disponível.", lib.lang(),
                                                    version=v, app=APP_NAME))
    window.events.closing += on_closing
    tray.start()
    lib.start()
    if "--update" in sys.argv:  # "LZ Launcher.exe --update": procura e instala a versão nova direto
        def update_now():
            info = lib.updater.check(auto=False)
            if info["status"] in ("available", "ready"):
                lib.updater.install()
        threading.Thread(target=update_now, daemon=True).start()
    webview.start(debug="--debug" in sys.argv, private_mode=False)
    tray.stop()
    lib.tracker.stop()
    lib.store.save()


if __name__ == "__main__":
    main()
