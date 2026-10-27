"""Integração com o Windows: iniciar com o Windows, volume, energia e trazer a janela para a frente."""
import ctypes
import os
import subprocess
import sys
import time
from pathlib import Path

try:
    import winreg
except ImportError:  # pragma: no cover
    winreg = None

from . import APP_NAME

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
user32 = ctypes.windll.user32 if os.name == "nt" else None


# --- iniciar com o Windows ----------------------------------------------------------
def startup_command() -> str:
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}" --startup'
    pyw = Path(sys.executable).with_name("pythonw.exe")
    main = Path(__file__).resolve().parent.parent / "main.py"
    return f'"{pyw if pyw.exists() else sys.executable}" "{main}" --startup'


def set_start_with_windows(on: bool) -> bool:
    if not winreg:
        return False
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
            if on:
                winreg.SetValueEx(k, APP_NAME, 0, winreg.REG_SZ, startup_command())
            else:
                try:
                    winreg.DeleteValue(k, APP_NAME)
                except FileNotFoundError:
                    pass
        return True
    except OSError:
        return False


def is_start_with_windows() -> bool:
    if not winreg:
        return False
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
            winreg.QueryValueEx(k, APP_NAME)
            return True
    except OSError:
        return False


# --- volume (teclas de mídia do Windows) --------------------------------------------
VK = {"up": 0xAF, "down": 0xAE, "mute": 0xAD}


def volume(action: str, steps: int = 2):
    key = VK.get(action)
    if not key or not user32:
        return False
    for _ in range(1 if action == "mute" else steps):
        user32.keybd_event(key, 0, 0, 0)
        user32.keybd_event(key, 0, 2, 0)
    return True


# --- energia ------------------------------------------------------------------------------
def power(action: str) -> bool:
    flags = 0x08000000  # sem janela
    if action == "sleep":
        # suspensão (não hiberna): SetSuspendState(hibernate=False, force=False, wakeup=False)
        try:
            ctypes.windll.powrprof.SetSuspendState(False, False, False)
            return True
        except Exception:
            return False
    if action == "restart":
        subprocess.Popen(["shutdown", "/r", "/t", "0"], creationflags=flags)
        return True
    if action == "shutdown":
        subprocess.Popen(["shutdown", "/s", "/t", "0"], creationflags=flags)
        return True
    return False


# --- trazer a janela do app para a frente -------------------------------------------
def bring_to_front(title: str = APP_NAME) -> bool:
    if not user32:
        return False
    hwnd = user32.FindWindowW(None, title)
    if not hwnd:
        return False
    SW_RESTORE = 9
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, SW_RESTORE)
    else:
        user32.ShowWindow(hwnd, 5)  # SW_SHOW
    # o Windows só deixa trocar o foco se o app "tiver tido" entrada: simula um Alt rápido
    user32.keybd_event(0x12, 0, 0, 0)
    user32.keybd_event(0x12, 0, 2, 0)
    ok = bool(user32.SetForegroundWindow(hwnd))
    user32.BringWindowToTop(hwnd)
    time.sleep(0.05)
    return ok
