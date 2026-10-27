"""Contador de tempo de jogo.

A cada poucos segundos verifica os processos em execução e associa cada um ao jogo cuja
pasta contém o executável. Assim conta o tempo mesmo quando o port abre outro processo
(ex.: "Play X.exe" -> jogo) ou quando o jogo é aberto fora do LZ Launcher.
"""
import os
import threading
import time

import psutil

from .paths import norm

POLL = 4.0
HISTORY_MAX = 400      # sessões guardadas por jogo
MIN_SESSION = 10       # segundos; sessões menores são ignoradas no histórico


def add_session(g: dict, start: float, end: float):
    """Registra uma sessão de jogo no histórico do jogo."""
    if end - start < MIN_SESSION:
        return
    hist = g.setdefault("history", [])
    hist.append({"s": round(start), "e": round(end)})
    if len(hist) > HISTORY_MAX:
        del hist[: len(hist) - HISTORY_MAX]


class PlayTracker:
    def __init__(self, library):
        self.lib = library
        self.running: dict[str, dict] = {}  # id -> {"start": t, "pids": [...]}
        self._stop = threading.Event()
        self._pending: dict[str, float] = {}  # jogos iniciados pelo app aguardando processo
        self.on_session_end = None  # chamado com o id do jogo quando ele fecha
        self.thread = threading.Thread(target=self._loop, name="tracker", daemon=True)

    def start(self):
        self._recover_open_sessions()
        self.thread.start()

    def _recover_open_sessions(self):
        """Sessões que ficaram abertas porque o app fechou com o jogo rodando."""
        with self.lib.store.lock:
            for g in self.lib.store.games.values():
                op = g.pop("open_session", None)
                if op and op.get("s") and op.get("l"):
                    add_session(g, op["s"], op["l"])

    def stop(self):
        self._stop.set()

    def mark_launched(self, gid: str):
        self._pending[gid] = time.time()

    def _roots(self):
        roots = []
        for gid, g in list(self.lib.store.games.items()):
            if g.get("missing") or g.get("hidden_untracked"):
                continue
            r = g.get("root")
            if r:
                roots.append((norm(r) + os.sep, gid))
        roots.sort(key=lambda x: len(x[0]), reverse=True)  # pasta mais específica primeiro
        return roots

    def _scan(self):
        roots = self._roots()
        if not roots:
            return {}
        own = os.getpid()
        found: dict[str, list] = {}
        for p in psutil.process_iter(["pid", "exe"]):
            try:
                exe = p.info.get("exe")
                if not exe or p.info["pid"] == own:
                    continue
                ne = os.path.normcase(exe)
                for root, gid in roots:
                    if ne.startswith(root):
                        found.setdefault(gid, []).append(p.info["pid"])
                        break
            except (psutil.Error, OSError):
                continue
        return found

    def _loop(self):
        last = time.time()
        save_counter = 0
        while not self._stop.wait(POLL):
            now = time.time()
            delta = min(now - last, POLL * 3)
            last = now
            try:
                found = self._scan()
            except Exception:
                continue
            track_ext = self.lib.store.settings.get("track_external", True)
            changed = False
            with self.lib.store.lock:
                games = self.lib.store.games
                for gid, pids in found.items():
                    g = games.get(gid)
                    if not g:
                        continue
                    launched_here = gid in self._pending or gid in self.running
                    if not track_ext and not launched_here:
                        continue
                    if gid not in self.running:
                        self.running[gid] = {"start": now, "pids": pids}
                        g["sessions"] = int(g.get("sessions", 0)) + 1
                        self._pending.pop(gid, None)
                        changed = True
                    else:
                        g["playtime"] = float(g.get("playtime", 0)) + delta
                        self.running[gid]["pids"] = pids
                    g["last_played"] = now
                    g["open_session"] = {"s": round(self.running[gid]["start"]), "l": round(now)}
                for gid in list(self.running):
                    if gid not in found:
                        info = self.running.pop(gid)
                        g = games.get(gid)
                        if g:
                            g["last_session"] = now - info["start"]
                            g.pop("open_session", None)
                            add_session(g, info["start"], now)
                        if self.on_session_end:
                            threading.Thread(target=self.on_session_end, args=(gid,), daemon=True).start()
                        changed = True
                for gid, t in list(self._pending.items()):
                    if now - t > 120:
                        self._pending.pop(gid, None)
            save_counter += 1
            if changed or (self.running and save_counter % 8 == 0):
                self.lib.store.save()

    def kill(self, gid: str) -> int:
        info = self.running.get(gid)
        if not info:
            return 0
        n = 0
        for pid in info["pids"]:
            try:
                proc = psutil.Process(pid)
                for ch in proc.children(recursive=True):
                    ch.terminate()
                proc.terminate()
                n += 1
            except psutil.Error:
                pass
        return n
