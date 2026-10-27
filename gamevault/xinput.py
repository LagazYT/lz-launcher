"""Leitura dos controles Xbox/XInput direto pelo Windows (funciona mesmo com o app em segundo plano).

Usado para:
- segurar View + Menu (ou o botão Xbox/Guide) por ~1,5 s: fecha o jogo aberto e volta para o LZ Launcher;
- nível da bateria de controles sem fio.
"""
import ctypes
import logging
import threading
import time
from ctypes import wintypes

log = logging.getLogger("gamevault.xinput")

BTN = {"up": 0x0001, "down": 0x0002, "left": 0x0004, "right": 0x0008, "start": 0x0010, "back": 0x0020,
       "l3": 0x0040, "r3": 0x0080, "lb": 0x0100, "rb": 0x0200, "guide": 0x0400,
       "a": 0x1000, "b": 0x2000, "x": 0x4000, "y": 0x8000}
HOLD_SECONDS = 1.5
BATTERY_LEVELS = {0: "empty", 1: "low", 2: "medium", 3: "full"}
BATTERY_TYPES = {0: "disconnected", 1: "wired", 2: "alkaline", 3: "nimh", 0xFF: "unknown"}


class XINPUT_GAMEPAD(ctypes.Structure):
    _fields_ = [("wButtons", wintypes.WORD), ("bLeftTrigger", ctypes.c_ubyte), ("bRightTrigger", ctypes.c_ubyte),
                ("sThumbLX", ctypes.c_short), ("sThumbLY", ctypes.c_short),
                ("sThumbRX", ctypes.c_short), ("sThumbRY", ctypes.c_short)]


class XINPUT_STATE(ctypes.Structure):
    _fields_ = [("dwPacketNumber", wintypes.DWORD), ("Gamepad", XINPUT_GAMEPAD)]


class XINPUT_BATTERY_INFORMATION(ctypes.Structure):
    _fields_ = [("BatteryType", ctypes.c_ubyte), ("BatteryLevel", ctypes.c_ubyte)]


def _load():
    for name in ("xinput1_4", "xinput1_3", "xinput9_1_0"):
        try:
            dll = ctypes.WinDLL(name)
        except OSError:
            continue
        get_state = dll.XInputGetState
        try:  # versão não documentada que também informa o botão Xbox (Guide)
            get_state = dll[100]
        except (AttributeError, OSError):
            pass
        battery = getattr(dll, "XInputGetBatteryInformation", None)
        return get_state, battery
    return None, None


class PadWatcher:
    """Thread leve que observa os controles e dispara ações."""

    def __init__(self, on_hold_combo=None):
        self.get_state, self.get_battery = _load()
        self.on_hold_combo = on_hold_combo
        self.connected: list[int] = []
        self.battery: dict | None = None
        self._hold_start = None
        self._fired = False
        self._stop = threading.Event()

    @property
    def available(self) -> bool:
        return self.get_state is not None

    def start(self):
        if self.available:
            threading.Thread(target=self._loop, name="xinput", daemon=True).start()

    def stop(self):
        self._stop.set()

    def _read(self, idx):
        st = XINPUT_STATE()
        if self.get_state(idx, ctypes.byref(st)) != 0:
            return None
        return st.Gamepad.wButtons

    def _read_battery(self, idx):
        if not self.get_battery:
            return None
        info = XINPUT_BATTERY_INFORMATION()
        if self.get_battery(idx, 0, ctypes.byref(info)) != 0:  # 0 = controle (não o headset)
            return None
        kind = BATTERY_TYPES.get(info.BatteryType, "unknown")
        if kind in ("disconnected", "wired", "unknown"):
            return {"wired": kind == "wired"}
        return {"wired": False, "level": BATTERY_LEVELS.get(info.BatteryLevel, "unknown")}

    def _loop(self):
        last_scan = 0.0
        last_battery = 0.0
        while not self._stop.wait(0.05):
            now = time.time()
            # procura controles a cada 2 s; lê só os conectados no resto do tempo
            if now - last_scan > 2:
                last_scan = now
                self.connected = [i for i in range(4) if self._read(i) is not None]
            if not self.connected:
                self.battery = None
                self._hold_start = None
                continue
            combo = False
            for i in self.connected:
                b = self._read(i)
                if b is None:
                    continue
                both = (b & BTN["back"]) and (b & BTN["start"])
                if both or (b & BTN["guide"]):
                    combo = True
            if combo:
                if self._hold_start is None:
                    self._hold_start = now
                elif not self._fired and now - self._hold_start >= HOLD_SECONDS:
                    self._fired = True
                    if self.on_hold_combo:
                        try:
                            self.on_hold_combo()
                        except Exception:
                            log.exception("hold combo")
            else:
                self._hold_start = None
                self._fired = False
            if now - last_battery > 30:
                last_battery = now
                self.battery = self._read_battery(self.connected[0])
