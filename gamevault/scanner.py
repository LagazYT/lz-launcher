"""Detecção de jogos dentro das pastas adicionadas pelo usuário.

Um jogo é uma pasta. Ele é classificado como "recompilado" quando contém um dump de
console (PS4/PS5/PS3 com param.sfo, Xbox com AppxManifest.xml) ou marcadores típicos de
ports recompilados (out/analysis.json, eboot.bin, *recomp*, etc.). Caso contrário é um
jogo "normal" de PC. Nada é gravado nas pastas dos jogos.
"""
import difflib
import hashlib
import os
import re
from pathlib import Path

from .paths import norm, app_root
from .sfo import read_sfo, read_appx, clean_title

MAX_DEPTH = 5
MAX_DIRS = 4000

# Executáveis auxiliares que nunca são o jogo
_EXCLUDE_EXE = [re.compile(p, re.I) for p in (
    r"probe$", r"gpu-capabilities", r"^createdump", r"pkgextract", r"realesrgan", r"^unins",
    r"setup", r"^install", r"redist", r"crash", r"easyanticheat", r"^eac(_|-|$)", r"battleye",
    r"^be_", r"cefprocess", r"webhelper", r"cefsharp", r"prereq", r"^python", r"^pythonw$",
    r"^(cmd|powershell|conhost|explorer)$", r"^ffmpeg", r"^ffprobe", r"^7z", r"^dotnet",
    r"^report", r"bugreport", r"^update(r)?$", r"^oalinst", r"physx", r"^dxsetup",
    r"^dxwebsetup", r"notification_helper", r"^crs-", r"^quicksfv", r"^vc_", r"^nvngx",
    r"^dlss", r"^zfgamebrowser", r"^steamerrorreporter", r"^gameoverlayui", r"^upc$",
    r"^errorreporter", r"^ue4prereq", r"^dowser", r"^touchup", r"^cleanup", r"^vulkaninfo",
    r"^elevate", r"shadercompile", r"^benchmark", r"^handle(64)?$", r"^winpty",
)]

# Pastas ignoradas na busca de executáveis
_SKIP_DIRS = {
    "_internal", "__pycache__", "redist", "_redist", "__installer", "_commonredist", "commonredist",
    "directx", "vcredist", "prereqs", "prerequisites", "installers", "installer", "support",
    "licenses", "saves", "savedata", "user", "shader", "shaders", "cache", "logs", "log",
    "fsr4_shaders", "dvdroot_ps4", "sce_module", "sce_sys", "embeddedxvd", "texture-tools",
    "extractor", "screenshots", "captures", "$recycle.bin", "system volume information",
    "engine", "_data", "out", "loop-previews", "fonts", "patches", "scripts", "crashpad",
    "crashreportclient", "easyanticheat", "battleye", "__macosx", ".git", "node_modules",
}

_RECOMP_NAME = re.compile(
    r"(recomp|pc[ _-]?port|\bport\b|-windows$|-pc$|bbport|azimuth|xenonrecomp|(?<![a-z])n64(?![a-z0-9]))", re.I)

_PLATFORM_PATTERNS = [
    ("PS5", re.compile(r"\bPPSA\d{5}\b|\bPS5\b")),
    ("PS4", re.compile(r"\bCUSA\d{5}\b|\bPS4\b|PlayStation 4")),
    ("PS3", re.compile(r"\b(BLUS|BLES|BCUS|BCES|NPUB|NPEB)\d{5}\b|\bPS3\b|PlayStation 3|RPCS3")),
    ("Xbox 360", re.compile(r"Xbox 360|XenonRecomp|\.xex\b", re.I)),
    ("Xbox One", re.compile(r"Xbox One|Durango", re.I)),
    ("PS2", re.compile(r"\bPS2\b|PlayStation 2")),
    ("Nintendo 64", re.compile(r"N64Recomp|Nintendo 64|\bN64\b")),
    ("GameCube", re.compile(r"GameCube", re.I)),
    ("Switch", re.compile(r"Nintendo Switch")),
]


def game_id_for(root: str) -> str:
    return "f_" + hashlib.sha1(norm(root).encode("utf-8")).hexdigest()[:14]


def is_excluded_exe(name: str) -> bool:
    stem = Path(name).stem.lower()
    return any(p.search(stem) for p in _EXCLUDE_EXE)


def _is_ps_dump(d: Path) -> bool:
    return (d / "sce_sys" / "param.sfo").is_file() or (d / "PS3_GAME" / "PARAM.SFO").is_file() \
        or (d / "PARAM.SFO").is_file() and (d / "USRDIR").is_dir()


def _is_xbox_dump(d: Path) -> bool:
    return (d / "AppxManifest.xml").is_file() and (
        (d / "appdata.bin").exists() or (d / "Logo.png").exists() or "mount" in d.name.lower())


def walk_game(root: Path):
    """Percorre a pasta do jogo (limitada) e retorna (exes, dumps, marcadores, imagens, readmes)."""
    exes, dumps, markers, images, readmes = [], [], set(), [], []
    stack = [(root, 0)]
    seen = 0
    while stack:
        d, depth = stack.pop()
        seen += 1
        if seen > MAX_DIRS:
            break
        try:
            entries = list(os.scandir(d))
        except OSError:
            continue
        names_lower = {e.name.lower() for e in entries}
        if "sce_sys" in names_lower and (d / "sce_sys" / "param.sfo").is_file():
            dumps.append(("ps", d))
            continue  # não procura executáveis dentro do dump do console
        if "ps3_game" in names_lower:
            dumps.append(("ps3", d))
            continue
        if "appxmanifest.xml" in names_lower and _is_xbox_dump(d):
            dumps.append(("xbox", d))
            continue
        for marker in ("eboot.bin", "eboot.elf", "bbport.ini", "patches.json", "azimuth.ini"):
            if marker in names_lower:
                markers.add(marker)
        if d.name.lower() == "out" and ("analysis.json" in names_lower or "link.json" in names_lower):
            markers.add("out/analysis.json")
        for e in entries:
            try:
                if e.is_dir(follow_symlinks=False):
                    lname = e.name.lower()
                    if lname == "out":
                        try:
                            sub = {x.lower() for x in os.listdir(e.path)}
                            if "analysis.json" in sub or "link.json" in sub or "eboot" in sub:
                                markers.add("out/analysis.json")
                        except OSError:
                            pass
                    if lname == "sys_modules":
                        markers.add("sys_modules")
                    if depth < MAX_DEPTH and lname not in _SKIP_DIRS and not lname.startswith("."):
                        stack.append((Path(e.path), depth + 1))
                    continue
                lname = e.name.lower()
                if lname.endswith(".exe"):
                    if not is_excluded_exe(e.name):
                        exes.append((Path(e.path), depth, e.stat().st_size))
                elif lname.endswith((".png", ".jpg", ".jpeg", ".webp")) and depth <= 3:
                    images.append(Path(e.path))
                elif lname.startswith("readme") and lname.endswith((".txt", ".md")) and depth <= 3:
                    readmes.append(Path(e.path))
            except OSError:
                continue
    return exes, dumps, markers, images, readmes


def looks_like_game(d: Path) -> bool:
    """Decide se a pasta adicionada já é um jogo (e não uma pasta com vários jogos)."""
    try:
        entries = list(os.scandir(d))
    except OSError:
        return False
    for e in entries:
        if e.is_file() and e.name.lower().endswith(".exe") and not is_excluded_exe(e.name):
            return True
        if e.is_file() and e.name.lower() in ("eboot.bin", "param.sfo", "appxmanifest.xml"):
            return True
        if e.is_dir():
            sub = Path(e.path)
            if e.name.lower() == "sce_sys" or _is_ps_dump(sub):
                return True
    return False


def _clean_folder_name(name: str) -> str:
    n = re.sub(r"[._]+", " ", name)
    n = re.sub(r"\b(pc[ -]?port|pc|windows|win64|recompiled|repack|portable)\b", "", n, flags=re.I)
    n = re.sub(r"[\[(].*?[\])]", "", n)
    n = re.sub(r"\s+", " ", n).strip(" -")
    return n or name


def _similar(a: str, b: str) -> float:
    a = re.sub(r"[^a-z0-9]", "", a.lower())
    b = re.sub(r"[^a-z0-9]", "", b.lower())
    if not a or not b:
        return 0.0
    if a in b or b in a:
        return 0.9
    return difflib.SequenceMatcher(None, a, b).ratio()


def _platform_from_readmes(readmes) -> str | None:
    counts = {}
    for r in readmes[:4]:
        try:
            text = open(r, "r", encoding="utf-8", errors="replace").read(20000)
        except OSError:
            continue
        for plat, pat in _PLATFORM_PATTERNS:
            n = len(pat.findall(text))
            if n:
                counts[plat] = counts.get(plat, 0) + n
    if not counts:
        return None
    return max(counts, key=counts.get)


def detect_game(root: Path, mode: str = "auto") -> dict | None:
    exes, dumps, markers, images, readmes = walk_game(root)
    if not exes and not dumps:
        return None

    info = {
        "root": str(root),
        "folder_name": root.name,
        "platform": "PC",
        "title_id": None,
        "version": None,
        "art_local": {},
        "dump": None,
    }
    title = None
    ps_dump = next((d for k, d in dumps if k == "ps"), None)
    ps3_dump = next((d for k, d in dumps if k == "ps3"), None)
    xbox_dump = next((d for k, d in dumps if k == "xbox"), None)

    if ps_dump:
        sfo = {}
        try:
            sfo = read_sfo(ps_dump / "sce_sys" / "param.sfo")
        except Exception:
            pass
        title = clean_title(sfo.get("TITLE", "")) or None
        tid = sfo.get("TITLE_ID") or ps_dump.name
        info["title_id"] = tid
        info["version"] = sfo.get("APP_VER") or sfo.get("VERSION")
        info["platform"] = "PS5" if str(tid).startswith("PPSA") else "PS4"
        info["dump"] = str(ps_dump)
        sys_dir = ps_dump / "sce_sys"
        for name in ("icon0.png", "icon0_00.png"):
            if (sys_dir / name).is_file():
                info["art_local"]["icon"] = str(sys_dir / name)
                break
        for name in ("pic1.png", "pic0.png", "pic1_00.png", "pic0_00.png"):
            if (sys_dir / name).is_file():
                info["art_local"]["hero"] = str(sys_dir / name)
                break
    elif ps3_dump:
        p = ps3_dump / "PS3_GAME" / "PARAM.SFO"
        try:
            sfo = read_sfo(p)
            title = clean_title(sfo.get("TITLE", "")) or None
            info["title_id"] = sfo.get("TITLE_ID")
            info["version"] = sfo.get("APP_VER")
        except Exception:
            pass
        info["platform"] = "PS3"
        info["dump"] = str(ps3_dump)
        for name, key in (("ICON0.PNG", "icon"), ("PIC1.PNG", "hero")):
            f = ps3_dump / "PS3_GAME" / name
            if f.is_file():
                info["art_local"][key] = str(f)
    elif xbox_dump:
        appx = read_appx(xbox_dump / "AppxManifest.xml")
        title = appx.get("name")
        info["platform"] = "Xbox One"
        info["dump"] = str(xbox_dump)
        if (xbox_dump / "Logo.png").is_file():
            info["art_local"]["icon"] = str(xbox_dump / "Logo.png")

    is_recomp = bool(dumps) or bool(markers) or bool(_RECOMP_NAME.search(root.name)) \
        or any(_RECOMP_NAME.search(p.stem) for p, _, _ in exes) \
        or any(_RECOMP_NAME.search(p.parent.name) for p, _, _ in exes)

    if is_recomp and info["platform"] == "PC":
        info["platform"] = _platform_from_readmes(readmes) or "Console"

    # Escolha do executável -----------------------------------------------------------
    play_exe = None
    alt_exe = None
    for p, depth, _size in sorted(exes, key=lambda x: x[1]):
        if p.stem.lower().startswith("play "):
            play_exe = p
            break
    if play_exe:
        target = play_exe.stem[5:].strip().lower()
        for p, _d, _s in exes:
            if p.parent == play_exe.parent and p.stem.lower() == target:
                alt_exe = p
                break
        if not title:
            title = play_exe.stem[5:].strip()

    name_hint = title or _clean_folder_name(root.name)

    def score(item):
        p, depth, size = item
        s = -12 * depth
        s += 45 * max(_similar(p.stem, name_hint), _similar(p.stem, root.name))
        s += min(size / (1024 * 1024), 300) / 12
        st = p.stem.lower()
        if "launcher" in st:
            s -= 6
        if st.endswith("-win64-shipping") or st.endswith("-wingdk-shipping"):
            s += 4
        if "debug" in st or "server" in st or "editor" in st:
            s -= 20
        return s

    ranked = sorted(exes, key=score, reverse=True)
    main_exe = play_exe or (ranked[0][0] if ranked else None)

    # Port launcher art (pasta "launcher/*.png" ao lado do executável)
    if main_exe:
        lp = main_exe.parent / "launcher"
        if lp.is_dir():
            pngs = sorted(lp.glob("*.png"), key=lambda f: f.stat().st_size, reverse=True)
            if pngs:
                info["art_local"].setdefault("logo", str(pngs[0]))
        icon0 = main_exe.parent / "icon0.png"
        if icon0.is_file():
            info["art_local"].setdefault("icon", str(icon0))
        art_dir = main_exe.parent / "art"
        if art_dir.is_dir():
            for f in art_dir.iterdir():
                if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
                    key = "hero" if "banner" in f.stem.lower() else "cover"
                    info["art_local"].setdefault(key, str(f))

    # Imagens "cover"/"capa" na raiz do jogo (escolha do usuário fora do app)
    for img in images:
        st = img.stem.lower()
        if st in ("cover", "capa", "boxart", "folder", "poster", "grid"):
            info["art_local"].setdefault("cover", str(img))
        elif st in ("hero", "background", "fundo", "banner"):
            info["art_local"].setdefault("hero", str(img))

    steam_appid = None
    for cand in (root / "steam_appid.txt",) + tuple(p.parent / "steam_appid.txt" for p, _, _ in ranked[:2]):
        try:
            if cand.is_file():
                txt = cand.read_text(errors="ignore").strip()
                if txt.isdigit():
                    steam_appid = int(txt)
                    break
        except OSError:
            pass

    if mode == "recompiled":
        kind = "recompiled"
    elif mode == "normal":
        kind = "normal"
    else:
        kind = "recompiled" if is_recomp else "normal"
    if kind == "recompiled" and info["platform"] == "PC":
        info["platform"] = "Console"
    elif kind == "normal" and not dumps:
        info["platform"] = "PC"

    info.update({
        "name_auto": title or _clean_folder_name(root.name),
        "kind_auto": kind,
        "exe_auto": str(main_exe) if main_exe else None,
        "alt_exe": str(alt_exe) if alt_exe else None,
        "exes": [str(p) for p, _, _ in ranked[:25]],
        "steam_appid": steam_appid,
        "images": [str(i) for i in images[:40]],
    })
    return info


def scan_folder(folder: str, mode: str = "auto"):
    """Gera os jogos de uma pasta adicionada (ela mesma ou suas subpastas)."""
    root = Path(folder)
    if not root.is_dir():
        return
    own = norm(str(app_root()))
    if looks_like_game(root):
        g = detect_game(root, mode)
        if g:
            yield g
        return
    try:
        children = sorted([Path(e.path) for e in os.scandir(root) if e.is_dir()], key=lambda p: p.name.lower())
    except OSError:
        return
    for child in children:
        lname = child.name.lower()
        if lname in _SKIP_DIRS or lname.startswith((".", "$")) or norm(str(child)) == own:
            continue
        g = detect_game(child, mode)
        if g:
            yield g
