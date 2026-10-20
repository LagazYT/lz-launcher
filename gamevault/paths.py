"""Locais de dados do aplicativo (nunca grava nada dentro das pastas dos jogos)."""
import os
import sys
from pathlib import Path


def app_root() -> Path:
    """Pasta onde o app está instalado (funciona também empacotado com PyInstaller)."""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent.parent


def is_portable() -> bool:
    """Versão portable: tem o arquivo portable.flag ao lado do .exe e guarda os dados na própria pasta."""
    return getattr(sys, "frozen", False) and (Path(sys.executable).parent / "portable.flag").exists()


def data_dir() -> Path:
    if is_portable():
        d = Path(sys.executable).parent / "data"
        d.mkdir(parents=True, exist_ok=True)
        return d
    base = os.environ.get("APPDATA") or str(Path.home())
    d = Path(base) / "LZ Launcher"
    old = Path(base) / "GameVault"  # nome antigo do app: migra os dados uma vez
    if old.is_dir() and not (d / "library.json").exists():
        try:
            if d.exists():
                d.rmdir()
            old.rename(d)
        except OSError:
            pass
    d.mkdir(parents=True, exist_ok=True)
    return d


def cache_dir(sub: str) -> Path:
    d = data_dir() / "cache" / sub
    d.mkdir(parents=True, exist_ok=True)
    return d


UI_DIR = app_root() / "ui"
LIBRARY_FILE = data_dir() / "library.json"
LOG_FILE = data_dir() / "gamevault.log"


def norm(p: str) -> str:
    """Caminho normalizado para comparação (minúsculas, separadores do Windows)."""
    return os.path.normcase(os.path.normpath(os.path.abspath(p)))
