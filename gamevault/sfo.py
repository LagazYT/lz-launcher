"""Leitura de param.sfo (PS3/PS4/PS Vita) e AppxManifest.xml (Xbox One)."""
import re
import struct
import xml.etree.ElementTree as ET


def read_sfo(path) -> dict:
    with open(path, "rb") as f:
        d = f.read()
    if d[:4] != b"\x00PSF":
        return {}
    _magic, _ver, key_table, data_table, count = struct.unpack("<4sIIII", d[:20])
    out = {}
    for i in range(count):
        ko, fmt, length, _max, do = struct.unpack("<HHIII", d[20 + i * 16:36 + i * 16])
        end = d.index(b"\0", key_table + ko)
        key = d[key_table + ko:end].decode("ascii", "replace")
        raw = d[data_table + do:data_table + do + length]
        if fmt == 0x0404:
            out[key] = struct.unpack("<I", raw[:4])[0]
        else:
            out[key] = raw.rstrip(b"\0").decode("utf-8", "replace")
    return out


def clean_title(t: str) -> str:
    t = t.replace("™", "").replace("®", "").replace("©", "")
    t = re.sub(r"\s+", " ", t).strip()
    # títulos em caixa alta ("SHADOW OF THE COLOSSUS") ficam em formato de título
    if t.isupper() and len(t) > 4:
        small = {"of", "the", "and", "a", "an", "in", "on", "to", "for"}
        words = t.lower().split(" ")
        t = " ".join(w if (i and w in small) else w[:1].upper() + w[1:] for i, w in enumerate(words))
    return t


def read_appx(path) -> dict:
    """Retorna DisplayName e se é um pacote de Xbox (namespace mx/xbox)."""
    try:
        text = open(path, "r", encoding="utf-8", errors="replace").read()
        root = ET.fromstring(text)
    except Exception:
        return {}
    name = None
    for el in root.iter():
        if el.tag.endswith("DisplayName") and el.text and not el.text.startswith("ms-resource"):
            name = el.text.strip()
            break
    is_xbox = "schemas.microsoft.com/appx/2013/xbox" in text or "xbox" in text.lower()
    return {"name": name, "xbox": is_xbox}
