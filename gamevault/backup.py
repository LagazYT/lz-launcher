"""Backup e restauração dos dados do LZ Launcher (para formatar, trocar de PC ou reinstalar).

O backup é um .zip com:
- library.json: jogos, tempo de jogo, histórico, conquistas, favoritos, nomes e configurações;
- avatar.png: a foto de perfil;
- art/: capas e imagens baixadas (inclui as escolhidas pelo usuário), para não precisar baixar de novo;
- extra/: imagens que o usuário escolheu de outras pastas do PC;
- manifest.json: versão, data e a pasta de dados de origem (para corrigir os caminhos ao restaurar).
Caches que o app refaz sozinho (ícones, troféus extraídos, atualizações) ficam de fora.
"""
import json
import logging
import os
import re
import shutil
import time
import zipfile
from pathlib import Path

from . import APP_NAME, APP_VERSION

log = logging.getLogger("gamevault.backup")
FORMAT = 1
KEEP_AUTO = 3  # backups automáticos guardados na pasta escolhida
# configurações que pertencem ao PC e não ao usuário: ficam como estão ao restaurar
MACHINE_SETTINGS = {"start_with_windows", "backup_dir", "backup_auto", "backup_last"}


def default_name(auto=False) -> str:
    return f"{APP_NAME} - backup{' automático' if auto else ''} {time.strftime('%Y-%m-%d %H-%M')}.zip"


def _under(path: str, folder: Path) -> bool:
    try:
        return Path(path).resolve().is_relative_to(folder.resolve())
    except Exception:
        return False


def create(dest: str, store, data_dir: Path, include_art=True) -> dict:
    """Grava o backup em dest (.zip). Devolve {path, size, games}."""
    with store.lock:
        data = json.loads(json.dumps(store.data))
    art_dir = data_dir / "cache" / "art"
    extra = {}
    for gid, g in data.get("games", {}).items():
        for k in ("cover", "hero"):
            p = g.get(k)
            if p and os.path.isfile(p) and not _under(p, data_dir):
                extra[p] = f"extra/{gid}_{k}{Path(p).suffix.lower()}"
    avatar = data.get("settings", {}).get("profile_avatar")
    manifest = {
        "app": APP_NAME, "format": FORMAT, "app_version": APP_VERSION, "created": time.time(),
        "data_dir": str(data_dir), "games": sum(1 for g in data.get("games", {}).values() if not g.get("missing")),
        "extra": extra, "avatar": bool(avatar and os.path.isfile(avatar)),
    }
    dest = str(dest)
    tmp = dest + ".part"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=1))
        z.writestr("library.json", json.dumps(data, ensure_ascii=False))
        if manifest["avatar"]:
            z.write(avatar, "avatar.png")
        for src, arc in extra.items():
            z.write(src, arc)
        if include_art and art_dir.is_dir():
            for f in art_dir.iterdir():
                if f.is_file():
                    # imagens já comprimidas: guardar sem recomprimir é bem mais rápido
                    z.write(f, f"art/{f.name}", compress_type=zipfile.ZIP_STORED)
    os.replace(tmp, dest)
    return {"path": dest, "size": os.path.getsize(dest), "games": manifest["games"]}


def inspect(path: str) -> dict | None:
    """Lê o resumo de um backup (ou None se o arquivo não for um backup do LZ Launcher)."""
    try:
        with zipfile.ZipFile(path) as z:
            m = json.loads(z.read("manifest.json").decode("utf-8"))
            if m.get("app") != APP_NAME or "library.json" not in z.namelist():
                return None
            return {"path": path, "created": m.get("created"), "games": m.get("games", 0), "app_version": m.get("app_version"),
                    "size": os.path.getsize(path)}
    except Exception:
        return None


def _rewrite(obj, old: str, new: str, mapping: dict):
    """Troca os caminhos da pasta de dados antiga pela nova (e os arquivos de 'extra' pelos restaurados)."""
    if isinstance(obj, dict):
        return {k: _rewrite(v, old, new, mapping) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_rewrite(v, old, new, mapping) for v in obj]
    if isinstance(obj, str):
        if obj in mapping:
            return mapping[obj]
        if old and old.lower() in obj.lower():  # inclui textos com vários caminhos (ex.: "a|b|c")
            return re.sub(re.escape(old), lambda _: new, obj, flags=re.IGNORECASE)
    return obj


def restore(path: str, store, data_dir: Path, defaults: dict) -> dict:
    """Restaura o backup por cima da biblioteca atual (que é guardada antes em library.before-restore.json)."""
    with zipfile.ZipFile(path) as z:
        m = json.loads(z.read("manifest.json").decode("utf-8"))
        if m.get("app") != APP_NAME:
            raise ValueError("not a backup")
        data = json.loads(z.read("library.json").decode("utf-8"))
        # cópia de segurança da biblioteca atual
        cur = data_dir / "library.json"
        if cur.is_file():
            shutil.copy2(cur, data_dir / "library.before-restore.json")
        art_dir = data_dir / "cache" / "art"
        art_dir.mkdir(parents=True, exist_ok=True)
        restored_dir = data_dir / "restored"
        mapping = {}
        for name in z.namelist():
            if name.startswith("art/") and not name.endswith("/"):
                (art_dir / Path(name).name).write_bytes(z.read(name))
            elif name.startswith("extra/") and not name.endswith("/"):
                restored_dir.mkdir(exist_ok=True)
                out = restored_dir / Path(name).name
                out.write_bytes(z.read(name))
                for src, arc in (m.get("extra") or {}).items():
                    if arc == name:
                        mapping[src] = str(out)
            elif name == "avatar.png":
                (data_dir / "avatar.png").write_bytes(z.read(name))
                mapping[(data.get("settings") or {}).get("profile_avatar", "")] = str(data_dir / "avatar.png")
    data = _rewrite(data, m.get("data_dir", ""), str(data_dir), {k: v for k, v in mapping.items() if k})

    with store.lock:
        # atualiza no lugar: outras partes do app guardam referência para esses objetos
        settings = store.settings
        keep = {k: settings.get(k) for k in MACHINE_SETTINGS if k in settings}
        settings.clear()
        settings.update(defaults)
        settings.update(data.get("settings") or {})
        settings.update(keep)
        games = store.games
        games.clear()
        games.update(data.get("games") or {})
        store.folders[:] = data.get("folders") or []
        for k, v in data.items():
            if k not in ("settings", "games", "folders"):
                store.data[k] = v
    store.save()
    return {"games": sum(1 for g in store.games.values() if not g.get("missing")), "created": m.get("created")}


def auto_backup_due(settings: dict, every_days=7) -> bool:
    folder = settings.get("backup_dir") or ""
    return bool(settings.get("backup_auto") and folder and os.path.isdir(folder)
                and time.time() - float(settings.get("backup_last") or 0) > every_days * 86400)


def run_auto(store, data_dir: Path) -> dict | None:
    """Faz o backup automático na pasta escolhida e apaga os automáticos mais antigos."""
    folder = Path(store.settings.get("backup_dir"))
    res = create(str(folder / default_name(auto=True)), store, data_dir)
    store.settings["backup_last"] = time.time()
    store.save(bump=False)
    autos = sorted(folder.glob(f"{APP_NAME} - backup automático *.zip"), key=lambda f: f.stat().st_mtime, reverse=True)
    for old in autos[KEEP_AUTO:]:
        try:
            old.unlink()
        except OSError:
            pass
    return res
