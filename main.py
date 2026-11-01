"""LZ Launcher - biblioteca e launcher de jogos recompilados e jogos de PC."""
import logging
import os
import sys
import threading
import time

import webview

from gamevault import APP_NAME
from gamevault.api import Api
from gamevault.i18n import tr
from gamevault.library import Library
from gamevault.overlay import TrophyOverlay
from gamevault.paths import LOG_FILE
from gamevault.server import make_server
from gamevault.system import bring_to_front, is_start_with_windows
from gamevault.tray import Tray
from gamevault.xinput import PadWatcher


def main():
    # deixa os sons de navegação do Modo TV tocarem mesmo quando a ação vem do controle
    os.environ.setdefault("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--autoplay-policy=no-user-gesture-required")
    logging.basicConfig(filename=LOG_FILE, level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    lib = Library()
    st = lib.store.settings
    st["start_with_windows"] = is_start_with_windows()  # o registro do Windows é a fonte da verdade
    api = Api(lib)
    srv = make_server(lib, api)
    url = f"http://127.0.0.1:{srv.server_address[1]}/index.html?t={srv.token}"
    # iniciado junto com o Windows: abre escondido na bandeja, a não ser que o Modo TV esteja ligado
    startup = "--startup" in sys.argv
    hidden = startup and not st.get("tv_on_start")
    window = webview.create_window(APP_NAME, url, js_api=api, width=1360, height=840, hidden=hidden,
                                   min_size=(980, 620), background_color="#141518")
    api._bind(window)
    quitting = threading.Event()
    # aviso de troféu/conquista por cima do jogo
    overlay = TrophyOverlay(f"http://127.0.0.1:{srv.server_address[1]}/overlay.html", st, lib.lang)

    def show_window():
        window.show()
        window.restore()

    def main_hwnd():
        try:
            return window.native.Handle.ToInt32()
        except Exception:
            return None

    def front():
        """Traz o LZ Launcher para a frente (inclusive se estiver minimizado ou escondido na bandeja)."""
        try:
            window.show()
        except Exception:
            pass
        for _ in range(4):
            if bring_to_front(APP_NAME, main_hwnd()):
                break
            time.sleep(0.25)
        if lib.tv_active:  # o Modo TV volta ocupando a tela inteira, sem a moldura de 1 px
            threading.Thread(target=api._fix_fullscreen_edges, daemon=True).start()

    def quit_app():
        quitting.set()
        tray.stop()
        overlay.destroy()
        window.destroy()

    tray = Tray(on_open=show_window, on_quit=quit_app, lang=lib.lang())

    def on_closing():
        # "Fechar" com a opção ligada só esconde a janela; o app segue na bandeja
        if not quitting.is_set() and st.get("close_to_tray", True):
            threading.Thread(target=lambda: (window.hide(), tray.notify_once()), daemon=True).start()
            return False
        return True

    def on_session_end(gid):
        # jogo fechou: se ele foi aberto pelo Modo TV, volta para o Modo TV
        if lib.tv_active and st.get("tv_return", True) and not lib.tracker.running:
            time.sleep(0.3)  # deixa a janela do jogo terminar de fechar
            front()
            lib.push_event("session_end", id=gid)

    def on_hold_combo():
        # segurou View + Menu (ou o botão Xbox): fecha o jogo aberto e volta para o launcher no Modo TV
        closed = []
        for gid in list(lib.tracker.running):
            if lib.tracker.kill(gid):
                closed.append(gid)
        front()
        lib.push_event("pad_home", closed=closed)

    def on_trophy(items):
        # som do aviso: o da pasta de sons do tema em uso (se o usuário colocou um), senão o som padrão do aviso
        theme = st.get("tv_theme") if lib.tv_active and st.get("tv_theme") else st.get("theme")
        files = lib.sound_files(theme or "sober")
        for it in items:
            rare = it.get("type") == "platinum" or (it.get("rarity") is not None and it["rarity"] < 5)
            it["sound_url"] = (files.get("platinum") if rare else None) or files.get("trophy")
        if st.get("ach_overlay", True):
            overlay.push(items)
        else:
            for it in items:
                tray.notify(f"{it.get('name')} — {it.get('game')}")

    lib.on_trophy = on_trophy
    window.events.closed += overlay.destroy
    lib.tracker.on_session_end = on_session_end
    lib.pad = PadWatcher(on_hold_combo=on_hold_combo)
    api._quit = quit_app
    lib.updater.quit_app = quit_app
    lib.updater.on_found = lambda v: tray.notify(tr("Nova versão {version} do {app} disponível.", lib.lang(),
                                                    version=v, app=APP_NAME))
    window.events.closing += on_closing
    tray.start()
    lib.start()
    lib.pad.start()
    if "--update" in sys.argv:  # "LZ Launcher.exe --update": procura e instala a versão nova direto
        def update_now():
            info = lib.updater.check(auto=False)
            if info["status"] in ("available", "ready"):
                lib.updater.install()
        threading.Thread(target=update_now, daemon=True).start()
    webview.start(debug="--debug" in sys.argv, private_mode=False)
    lib.pad.stop()
    tray.stop()
    lib.tracker.stop()
    lib.store.save()


if __name__ == "__main__":
    main()
