"""Aviso de troféu/conquista desbloqueada por cima do jogo.

É uma janela pequena e sem bordas que fica fora da tela até ser usada. Ela aparece no canto superior direito do
monitor onde o jogo está, sempre por cima, sem ativar a janela (o jogo não perde o foco nem minimiza) e sem
receber cliques. Jogos em tela cheia exclusiva podem cobrir o aviso; em "janela sem bordas" ele aparece normal.
"""
import ctypes
import json
import logging
import queue
import threading
import time
from ctypes import wintypes

import webview

log = logging.getLogger("gamevault.overlay")
user32 = ctypes.windll.user32
# tipos explícitos: sem isso o HWND_TOPMOST (-1) chega errado no Windows 64 bits e a janela não se move
user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_uint]
user32.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
user32.SetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_long]
TITLE = "LZ Launcher - Notificação"
WIDTH, HEIGHT = 460, 104
SHOW_SECONDS = 6.3
OFF = -12000   # fora da tela (-32000 o Windows trata como janela minimizada)


class RECT(ctypes.Structure):
    _fields_ = [("l", ctypes.c_long), ("t", ctypes.c_long), ("r", ctypes.c_long), ("b", ctypes.c_long)]


class MONITORINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", RECT), ("rcWork", RECT), ("dwFlags", wintypes.DWORD)]


class TrophyOverlay:
    def __init__(self, base_url: str, settings: dict, lang_fn):
        self.settings = settings
        self.lang_fn = lang_fn
        self.q: queue.Queue = queue.Queue()
        self.hwnd = None
        self.ready = threading.Event()
        self.window = webview.create_window(
            TITLE, base_url, width=WIDTH, height=HEIGHT, x=OFF, y=OFF, frameless=True, on_top=True, focus=False,
            resizable=False, easy_drag=False, shadow=False, background_color="#0b0d12")
        self.window.events.loaded += self._on_loaded
        threading.Thread(target=self._worker, name="overlay", daemon=True).start()

    def _on_loaded(self):
        try:
            h = self.window.native.Handle.ToInt32()
        except Exception:
            h = user32.FindWindowW(None, TITLE)
        if h:
            GWL_EXSTYLE = -20
            WS_EX_TOOLWINDOW, WS_EX_NOACTIVATE, WS_EX_TRANSPARENT, WS_EX_LAYERED = 0x80, 0x08000000, 0x20, 0x80000
            ex = user32.GetWindowLongW(h, GWL_EXSTYLE)
            user32.SetWindowLongW(h, GWL_EXSTYLE, ex | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT | WS_EX_LAYERED)
            user32.SetLayeredWindowAttributes(h, 0, 255, 0x2)  # opaca, mas deixa os cliques passarem
            try:  # cantos arredondados no Windows 11
                v = ctypes.c_int(2)
                ctypes.windll.dwmapi.DwmSetWindowAttribute(h, 33, ctypes.byref(v), 4)
            except Exception:
                pass
            self._move(h, OFF, OFF)
            self.hwnd = h
            self.ready.set()

    def push(self, items: list):
        for it in items:
            self.q.put(it)

    def destroy(self):
        try:
            self.window.destroy()
        except Exception:
            pass

    @staticmethod
    def _move(h, x, y, show=False):
        HWND_TOPMOST = wintypes.HWND(-1)
        SWP_NOSIZE, SWP_NOACTIVATE, SWP_SHOWWINDOW = 0x1, 0x10, 0x40
        if show and user32.IsIconic(h):
            user32.ShowWindow(h, 4)  # SW_SHOWNOACTIVATE: restaura sem ativar
        user32.SetWindowPos(h, HWND_TOPMOST, x, y, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE | (SWP_SHOWWINDOW if show else 0))

    def _target_position(self):
        """Canto superior direito do monitor da janela em primeiro plano (o jogo)."""
        mon = user32.MonitorFromWindow(user32.GetForegroundWindow(), 2)
        info = MONITORINFO()
        info.cbSize = ctypes.sizeof(MONITORINFO)
        user32.GetMonitorInfoW(mon, ctypes.byref(info))
        r = RECT()
        user32.GetWindowRect(self.hwnd, ctypes.byref(r))
        w = r.r - r.l
        m = info.rcMonitor
        margin = int(24 * (w / WIDTH)) if w else 24
        return m.r - w - margin, m.t + margin

    def _worker(self):
        while True:
            item = self.q.get()
            if not self.ready.wait(timeout=20):
                continue
            try:
                lang = self.lang_fn()
                sound = "true" if self.settings.get("ach_sound", True) else "false"
                self.window.evaluate_js(f"showTrophy({json.dumps(item, ensure_ascii=False)}, {json.dumps(lang)}, {sound})")
                x, y = self._target_position()
                self._move(self.hwnd, x, y, show=True)
                time.sleep(SHOW_SECONDS)
                self.window.evaluate_js("hideTrophy()")
                time.sleep(0.4)
                self._move(self.hwnd, OFF, OFF)
                time.sleep(0.3)
            except Exception as e:
                log.warning("overlay: %s", e)
