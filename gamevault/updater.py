"""Atualização automática a partir das releases do GitHub.

- Verifica a release mais recente em github.com/<REPO>/releases.
- Versão instalada: baixa o instalador (LZ-Launcher-Setup-x.y.z.exe) e roda em modo silencioso;
  o instalador fecha o app, atualiza e abre de novo.
- Versão portable: baixa o .zip, e um pequeno script copia os arquivos novos por cima da pasta
  do app depois que ele fecha (a pasta "data" com a biblioteca é mantida) e abre o app de novo.
"""
import logging
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from pathlib import Path

import requests

from . import APP_VERSION, GITHUB_REPO
from .paths import data_dir, is_portable

log = logging.getLogger("gamevault.updater")
CHECK_EVERY = 6 * 3600
API = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"


def parse_version(v: str) -> tuple:
    nums = re.findall(r"\d+", v or "")
    return tuple(int(n) for n in nums[:3]) + (0,) * (3 - len(nums[:3]))


def install_mode() -> str:
    """installed = instalado pelo instalador (tem desinstalador ao lado do .exe);
    portable = pasta solta (atualiza copiando o .zip por cima)."""
    if not getattr(sys, "frozen", False):
        return "source"
    if any(Path(sys.executable).parent.glob("unins*.exe")):
        return "installed"
    return "portable"


class Updater:
    def __init__(self, library):
        self.lib = library
        self.status = "idle"  # idle | checking | uptodate | available | downloading | ready | installing | error
        self.latest: dict | None = None
        self.progress = 0.0
        self.error = ""
        self.last_check = 0.0
        self.file: str | None = None
        self.quit_app = None  # definido pelo main: fecha o app para atualizar
        self.on_found = None  # aviso na bandeja
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    def start(self):
        threading.Thread(target=self._loop, name="updater", daemon=True).start()

    def _loop(self):
        time.sleep(6)
        while True:
            if self.lib.store.settings.get("check_updates", True):
                self.check(auto=True)
            time.sleep(CHECK_EVERY)

    def info(self) -> dict:
        return {
            "current": APP_VERSION,
            "status": self.status,
            "latest": self.latest,
            "progress": round(self.progress, 3),
            "error": self.error,
            "mode": install_mode(),
            "repo": GITHUB_REPO,
            "last_check": self.last_check or None,
        }

    def _asset_for_mode(self, assets: list) -> dict | None:
        mode = install_mode()
        want = re.compile(r"portable.*\.zip$" if mode == "portable" else r"setup.*\.exe$", re.I)
        return next((a for a in assets if want.search(a.get("name", ""))), None)

    def check(self, auto=False) -> dict:
        if not self._lock.acquire(blocking=False):
            return self.info()
        try:
            if self.status in ("downloading", "installing"):
                return self.info()
            self.status, self.error = "checking", ""
            self.lib.store.touch()
            r = requests.get(API, timeout=15, headers={"Accept": "application/vnd.github+json",
                                                        "User-Agent": f"LZLauncher/{APP_VERSION}"})
            self.last_check = time.time()
            if r.status_code == 404:
                self.status = "uptodate"
                return self.info()
            r.raise_for_status()
            rel = r.json()
            tag = rel.get("tag_name", "")
            asset = self._asset_for_mode(rel.get("assets", []))
            newer = parse_version(tag) > parse_version(APP_VERSION)
            if not newer:
                self.status, self.latest = "uptodate", None
                return self.info()
            self.latest = {
                "version": tag.lstrip("vV"),
                "name": rel.get("name") or tag,
                "notes": (rel.get("body") or "").strip(),
                "url": rel.get("html_url"),
                "published": rel.get("published_at"),
                "asset": asset.get("browser_download_url") if asset else None,
                "asset_name": asset.get("name") if asset else None,
                "size": asset.get("size") if asset else None,
            }
            if self.status != "ready" or not self.file:
                self.status = "available"
            if self.on_found:
                try:
                    self.on_found(self.latest["version"])
                except Exception:
                    pass
            # baixa sozinho em segundo plano quando a opção estiver ligada
            if auto and self.lib.store.settings.get("auto_update", True) and asset and install_mode() != "source":
                threading.Thread(target=self.download, daemon=True).start()
        except Exception as e:
            log.warning("update check: %s", e)
            self.status, self.error = "error", "Não foi possível verificar atualizações (sem internet?)."
        finally:
            self._lock.release()
            self.lib.store.touch()
        return self.info()

    # ------------------------------------------------------------------
    def download(self) -> bool:
        lt = self.latest
        if not lt or not lt.get("asset") or self.status in ("downloading", "installing"):
            return False
        if self.status == "ready" and self.file and os.path.isfile(self.file):
            return True
        folder = data_dir() / "updates"
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / lt["asset_name"]
        try:
            self.status, self.progress, self.error = "downloading", 0.0, ""
            self.lib.store.touch()
            with requests.get(lt["asset"], stream=True, timeout=30,
                              headers={"User-Agent": f"LZLauncher/{APP_VERSION}"}) as r:
                r.raise_for_status()
                total = int(r.headers.get("content-length") or lt.get("size") or 0)
                done = 0
                tmp = str(target) + ".part"
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(256 * 1024):
                        f.write(chunk)
                        done += len(chunk)
                        if total:
                            self.progress = done / total
            os.replace(tmp, target)
            self.file = str(target)
            self.status, self.progress = "ready", 1.0
            return True
        except Exception as e:
            log.warning("update download: %s", e)
            self.status, self.error = "error", "Falha ao baixar a atualização. Tente de novo."
            return False
        finally:
            self.lib.store.touch()

    def install(self) -> dict:
        """Baixa (se preciso) e instala. O app é fechado e reaberto já atualizado."""
        mode = install_mode()
        if mode == "source":
            return {"ok": False, "error": "Rodando pelo código-fonte: atualize com git pull. Abrindo a página da release…",
                    "url": (self.latest or {}).get("url")}
        if self.status != "ready" and not self.download():
            return {"ok": False, "error": self.error or "Nenhuma atualização disponível."}
        try:
            self.status = "installing"
            self.lib.store.touch()
            self.lib.store.save()
            if mode == "installed":
                _spawn([self.file, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS"])
            else:
                self._apply_portable()
        except Exception as e:
            log.exception("update install")
            self.status, self.error = "error", f"Falha ao instalar: {e}"
            return {"ok": False, "error": self.error}
        if self.quit_app:
            threading.Timer(1.0, self.quit_app).start()
        return {"ok": True}

    def _apply_portable(self):
        app_dir = Path(sys.executable).parent
        work = Path(tempfile.mkdtemp(prefix="lzupdate_"))
        with zipfile.ZipFile(self.file) as z:
            z.extractall(work)
        # o zip tem uma pasta "LZ Launcher" com o programa dentro
        src = next((p.parent for p in work.rglob("LZ Launcher.exe")), work)
        exe = app_dir / "LZ Launcher.exe"
        # pasta solta sem portable.flag continua guardando os dados no %APPDATA%
        keep_flag = "" if is_portable() else " /XF portable.flag"
        script = work / "aplicar_update.cmd"
        pid = os.getpid()
        lines = [
            "@echo off",
            # espera o LZ Launcher fechar
            ":esperar",
            f'tasklist /FI "PID eq {pid}" /NH | find "{pid}" >nul && (ping -n 2 127.0.0.1 >nul & goto esperar)',
            f'robocopy "{src}" "{app_dir}" /E /R:5 /W:1 /NFL /NDL /NJH /NJS /NP{keep_flag} >nul',
            f'cd /d "{app_dir}"',
            f'start "" "{exe}"',
            f'rmdir /s /q "{work}" & exit',
        ]
        with open(script, "w", encoding="mbcs", newline="\r\n") as f:
            f.write("\n".join(lines) + "\n")
        _spawn(["cmd", "/c", str(script)], cwd=tempfile.gettempdir())


def _spawn(cmd: list, cwd: str | None = None):
    """Inicia um processo invisível que sobrevive ao fechamento do LZ Launcher."""
    base = 0x08000000 | 0x00000200  # CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
    try:
        subprocess.Popen(cmd, cwd=cwd, creationflags=base | 0x01000000, close_fds=True)  # + BREAKAWAY_FROM_JOB
    except OSError:
        subprocess.Popen(cmd, cwd=cwd, creationflags=base, close_fds=True)
