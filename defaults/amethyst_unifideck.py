"""Games installed by Unifideck (a Decky plugin for Epic, GOG and Amazon).

Amethyst doesn't know about Unifideck: it installs Epic games with its own
copy of Legendary (config in ~/.config/legendary, not inside Heroic) and adds
each game to Steam as a non-Steam shortcut that runs Unifideck's launcher, so
Amethyst's shortcut scan can't match the game's exe either.

What we read (all written by Unifideck, never modified here):
- ~/.local/share/unifideck/games.map: one row per installed game,
  ``store:game_id=exe<TAB>work_dir<TAB>app_id`` (older rows omit columns).
  app_id is the Steam shortcut id, stored signed.
- ~/.config/legendary/installed.json: Epic install paths by appName.
- ~/.local/share/unifideck/prefixes/: Wine prefixes. Unifideck links each
  one into Steam's compatdata/<app_id> on the game's first launch.

The game is then saved in Amethyst as a non-Steam shortcut (shortcut_appid),
which is how Amethyst itself resolves a shortcut install's prefix.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


def _data_dir() -> Path:
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "unifideck"


def _config_home() -> Path:
    return Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")


@dataclass
class Row:
    store: str
    game_id: str
    exe: str
    work_dir: Path
    app_id: str      # unsigned shortcut id, or "" when Unifideck hasn't filled it in


def load_rows() -> list[Row]:
    """Parse games.map the way Unifideck does (services/shortcut/games_map.py)."""
    try:
        text = (_data_dir() / "games.map").read_text(encoding="utf-8")
    except OSError:
        return []
    rows = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        store, _, game_id = key.strip().partition(":")
        parts = value.split("\t")
        exe = parts[0].strip()
        work = parts[1].strip() if len(parts) > 1 else str(Path(exe).parent)
        try:
            app = int(parts[2].strip()) & 0xFFFFFFFF if len(parts) > 2 else 0
        except ValueError:
            app = 0
        if game_id and work:
            rows.append(Row(store, game_id, exe, Path(work), str(app) if app else ""))
    return rows


def _legendary_installed() -> dict:
    try:
        data = json.loads((_config_home() / "legendary" / "installed.json").read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _root_for_exe(row: Row, exe_name: str) -> "Path | None":
    """Install root if *row* holds the handler's exe (``bin/x.exe`` or bare)."""
    rel = [p for p in exe_name.replace("\\", "/").lower().split("/") if p]
    if not rel:
        return None
    stored = Path(row.exe)
    if [p.lower() for p in stored.parts[-len(rel):]] == rel and len(stored.parts) > len(rel):
        return stored.parents[len(rel) - 1]
    if (row.work_dir / Path(*rel)).is_file():
        return row.work_dir
    return None


def find(exe_names: list[str], app_names: list[str], rows: "list[Row] | None" = None):
    """(install root, Row) for a game, or None.

    When the handler declares store app names (Amethyst's heroic_app_names:
    Epic appNames and GOG product ids) only those match, like Amethyst's own
    Heroic lookup; otherwise the handler's exe names are matched."""
    rows = load_rows() if rows is None else rows
    names = {n.lower() for n in app_names if n}
    if names:
        epic = None
        for row in rows:
            if row.game_id.lower() not in names:
                continue
            root = row.work_dir
            if row.store == "epic":
                epic = epic if epic is not None else _legendary_installed()
                entry = epic.get(row.game_id) or {}
                if entry.get("install_path"):
                    root = Path(entry["install_path"])
            if root.is_dir():
                return root, row
        return None
    for row in rows:
        for exe in exe_names:
            root = _root_for_exe(row, exe)
            if root is not None and root.is_dir():
                return root, row
    return None


def prefix_for(row: Row) -> "Path | None":
    """The game's prefix: Steam's compatdata link once launched, else
    Unifideck's own folder (prefixes/<id> for Epic, prefixes/<store>/<id>)."""
    if row.app_id:
        try:
            from Utils.launchers.steam import find_prefix
            found = find_prefix(row.app_id, row.work_dir)
            if found:
                return Path(found)
        except Exception:
            pass
    base = _data_dir() / "prefixes"
    for cand in (base / row.game_id, base / row.store / row.game_id):
        if (cand / "pfx").is_dir():
            return cand / "pfx"
        if (cand / "drive_c").is_dir():
            return cand
    return None
