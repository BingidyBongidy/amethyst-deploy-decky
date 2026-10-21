"""Where is a game installed? Mirrors Amethyst's Configure Game auto-detect.

`install_candidates(g)` yields the places a game is installed, best first
(ConfigureGameView._game_scan_worker in gui_qt/configure_game_view.py);
`find_prefix(...)` finds its Wine/Proton prefix through the same launcher
(ConfigureGameView._prefix_scan_worker). Everything here only reads.

A candidate is a dict: source (launcher name), path, prefix (Path or None),
id (the launcher's id for the game) and prefix_mode ("native", "resolved" or
"detect", as the GUI calls them).
"""
from __future__ import annotations

import importlib
import json
import traceback
from pathlib import Path

import amethyst_unifideck as unifideck

# ---------------------------------------------------------------- the handler


def exe_names(g) -> list[str]:
    """The exes that identify the game, as the Configure Game dialog uses them."""
    names = list(getattr(g, "configure_exe_names", []) or [])
    if not names:
        names = [getattr(g, "exe_name", None)] + list(getattr(g, "exe_name_alts", []) or [])
    return [n for n in names if n]


def base_plugin_markers(g) -> list[str]:
    """Files that mark a game root besides its exe: the base game's plugins."""
    return [f"Data/{p}" for p in getattr(g, "vanilla_plugins", []) or []]


def game_markers(g) -> list[str]:
    """What a real game folder holds (see amethyst_gameroot)."""
    return exe_names(g) + base_plugin_markers(g)


def heroic_app_names(g) -> list[str]:
    """Mirror of _heroic_app_names in gui_qt/configure_game_view.py: the
    handler's declared Epic/GOG ids, else one saved in the game's config."""
    names = list(getattr(g, "heroic_app_names", []) or [])
    if names or not getattr(g, "name", None):
        return names
    try:
        from Utils.config_paths import get_game_config_path
        path = get_game_config_path(g.name)
        if path.is_file():
            config = json.loads(path.read_text(encoding="utf-8"))
            saved = (config.get("heroic_app_name") or "").strip()
            return [saved] if saved else []
    except Exception:
        pass
    return []


def is_native_exe(exe) -> bool:
    """Mirror of _is_native_exe_name in gui_qt/configure_game_view.py."""
    return bool(exe) and Path(str(exe)).suffix.casefold() not in {
        ".exe", ".bat", ".cmd", ".com", ".msi"}


def _candidate(source, path, prefix, launcher_id, exe=None) -> dict:
    if is_native_exe(exe):
        mode = "native"
    elif prefix:
        mode = "resolved"
    else:
        mode = "detect"
    return {"source": source, "path": Path(path),
            "prefix": Path(prefix) if prefix else None,
            "id": launcher_id, "prefix_mode": mode}


def _first(find, names: list[str]):
    """(info, exe) for the first exe name that *find* recognises."""
    for exe in names:
        info = find(exe)
        if info:
            return info, exe
    return None, None


# ---------------------------------------------------------------- candidates


def _heroic(names, app_names):
    from Utils.launchers.heroic import (
        find_heroic_game_info_by_app_names, find_heroic_game_info_by_exe)
    if app_names:
        # Declared app names are authoritative; the GUI skips the exe scan.
        info, exe = find_heroic_game_info_by_app_names(app_names), None
    else:
        info, exe = _first(find_heroic_game_info_by_exe, names)
    if info:
        yield _candidate("heroic", *info, exe)


def _exe_launchers(names):
    from Utils.launchers.lutris import find_lutris_game_info_by_exe
    from Utils.launchers.faugus import find_faugus_game_info_by_exe
    for source, finder in (("lutris", find_lutris_game_info_by_exe),
                           ("faugus", find_faugus_game_info_by_exe)):
        info, exe = _first(finder, names)
        if info:
            yield _candidate(source, *info, exe)


def _bottles(names):
    from Utils.launchers.bottles import find_bottles_game_info_by_exes
    info = find_bottles_game_info_by_exes(names)
    if info:
        yield _candidate("bottles", *info)


def _unifideck(g, names, app_names):
    # Not in the GUI: Unifideck installs are Steam shortcuts Amethyst can't match.
    hit = unifideck.find(names, app_names, markers=base_plugin_markers(g))
    if hit:
        root, row, exe = hit
        yield _candidate("unifideck", root, unifideck.prefix_for(row), row.app_id, exe)


def _shortcut(names):
    from Utils.launchers.steam_shortcuts import find_shortcut_game_info_by_exe
    info, exe = _first(find_shortcut_game_info_by_exe, names)
    if info:
        yield _candidate("shortcut", *info, exe)


def _steam(g, names):
    steam_id = str(getattr(g, "steam_id", "") or "")
    if not steam_id:
        return
    from Utils.launchers.steam import (
        find_steam_libraries, find_game_by_steam_id, find_game_in_libraries)
    libraries = find_steam_libraries()
    path, exe = _first(lambda e: find_game_by_steam_id(libraries, steam_id, e), names)
    if not path:
        path, exe = _first(lambda e: find_game_in_libraries(libraries, e), names)
    if path:
        yield _candidate("steam", path, None, None, exe)


def _standalone(g, log):
    try:
        detect = getattr(g, "detect_standalone_install", None)
        path = detect() if callable(detect) else None
        if path is not None:
            yield _candidate("standalone", path, None, None, getattr(g, "exe_name", None))
    except Exception as e:
        log(f"standalone detection failed: {e}")


def install_candidates(g, log):
    """Yield where *g* is installed, best first; callers take the first, as the
    GUI auto-applies candidates[0]. Same order as the GUI (Heroic, Lutris,
    Faugus, Bottles, non-Steam shortcut, Steam), with Unifideck before
    shortcuts, then a standalone install only if nothing else matched."""
    names, app_names = exe_names(g), heroic_app_names(g)
    found = False
    try:
        for source in (_heroic(names, app_names), _exe_launchers(names), _bottles(names),
                       _unifideck(g, names, app_names), _shortcut(names), _steam(g, names)):
            for candidate in source:
                found = True
                yield candidate
    except Exception as e:
        traceback.print_exc()
        log(f"install scan failed: {e}")
    if not found:
        yield from _standalone(g, log)


# ---------------------------------------------------------------- prefixes


def _steam_prefix(g, game_path, source, launcher_id):
    """Steam compatdata, by the shortcut's app id first when it has one."""
    from Utils.launchers.steam import find_prefix as find_steam_prefix
    alt_ids = [str(s) for s in getattr(g, "alt_steam_ids", []) or [] if s]
    ids = [getattr(g, "steam_id", None)] + alt_ids
    try:
        saved = g.get_shortcut_appid() or ""
    except AttributeError:
        saved = ""
    if source == "shortcut" and launcher_id:
        ids = [launcher_id]
    elif saved:
        ids.insert(0, saved)
    for app_id in [x for x in ids if x]:
        found = find_steam_prefix(app_id, game_path)
        if found:
            return found
    return None


def _heroic_prefix(g, launcher_id):
    from Utils.launchers.heroic import find_heroic_prefix
    return find_heroic_prefix([str(launcher_id)] if launcher_id else heroic_app_names(g))


_EXE_PREFIX_FINDERS = (
    ("lutris", "Utils.launchers.lutris", "find_lutris_game_info_by_exe"),
    ("faugus", "Utils.launchers.faugus", "find_faugus_game_info_by_exe"),
    ("shortcut", "Utils.launchers.steam_shortcuts", "find_shortcut_game_info_by_exe"),
)


def _exe_launcher_prefix(names, source, launcher_id):
    for src, module, function in _EXE_PREFIX_FINDERS:
        if source not in (None, src):
            continue
        find = getattr(importlib.import_module(module), function)
        for exe in names:
            info = find(exe)
            if not info or info[1] is None:
                continue
            if not launcher_id or str(info[2]) == str(launcher_id):
                return info[1]
    return None


def _bottles_prefix(names, game_path, launcher_id):
    from Utils.launchers.bottles import find_bottles_game_info_by_exes
    info = find_bottles_game_info_by_exes(names, game_path=game_path, program_id=launcher_id)
    return info[1] if info else None


def find_prefix(g, game_path, source, launcher_id, log):
    """Mirror of ConfigureGameView._prefix_scan_worker: look for the prefix
    through the launcher the install came from (any launcher if None)."""
    alts = list(getattr(g, "exe_name_alts", []) or [])
    names = [e for e in [getattr(g, "exe_name", None), *alts] if e]
    # (sources that use this lookup, lookup), tried in the GUI's order.
    lookups = [
        ((None, "steam", "shortcut"),
         lambda: _steam_prefix(g, game_path, source, launcher_id)),
        ((None, "heroic"),
         lambda: _heroic_prefix(g, launcher_id)),
        ((None, "lutris", "faugus", "shortcut"),
         lambda: _exe_launcher_prefix(names, source, launcher_id)),
        ((None, "bottles"),
         lambda: _bottles_prefix(names, game_path, launcher_id)),
    ]
    try:
        for sources, lookup in lookups:
            if source in sources:
                found = lookup()
                if found:
                    return found
    except Exception as e:
        log(f"prefix lookup failed: {e}")
    return None
