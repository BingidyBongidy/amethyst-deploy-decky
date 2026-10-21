"""Write minimal Bethesda plugin files (TES4 header with masters) for the tests.

As a script: python3 mkplugin.py <Data folder> writes Skyrim SE's base plugins.
"""
from __future__ import annotations

import struct
import sys
from pathlib import Path

SKYRIM_BASE = ["Skyrim.esm", "Update.esm", "Dawnguard.esm", "HearthFires.esm", "Dragonborn.esm"]


def _subrecord(tag: str, data: bytes) -> bytes:
    return tag.encode() + struct.pack("<H", len(data)) + data


def write_plugin(path, masters: list[str], esm: bool = False) -> None:
    """A plugin whose header lists *masters*; *esm* sets the master flag."""
    body = _subrecord("HEDR", struct.pack("<fiI", 1.71, 0, 0x800))
    for master in masters:
        body += _subrecord("MAST", master.encode() + b"\0") + _subrecord("DATA", b"\0" * 8)
    flags = 1 if esm else 0
    header = b"TES4" + struct.pack("<IIIIHH", len(body), flags, 0, 0, 44, 0)
    Path(path).write_bytes(header + body)


if __name__ == "__main__":
    data_folder = Path(sys.argv[1])
    for name in SKYRIM_BASE:
        masters = [] if name == "Skyrim.esm" else ["Skyrim.esm"]
        write_plugin(data_folder / name, masters, esm=True)
