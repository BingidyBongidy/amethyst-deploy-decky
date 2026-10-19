"""Amethyst bridge - runs INSIDE Amethyst's Flatpak python, started by the plugin.

Line-delimited JSON-RPC over stdin/stdout:
    request : {"id": 1, "method": "mods", "params": {...}}
    response: {"id": 1, "result": ...}  or  {"id": 1, "error": "message"}

Calls Amethyst's own modules (the same ones its GUI uses) so the controller UI
behaves identically: modlist.txt, plugins.txt/loadorder.txt, LOOT, game setup.
Anything Amethyst prints goes to stderr; stdout carries only responses.
"""
from __future__ import annotations

import importlib
import json
import os
import sys
import traceback
from pathlib import Path

# Claim the real stdout for RPC, then point fd 1 (and sys.stdout) at stderr so
# stray prints from Amethyst can't corrupt the protocol.
_rpc = os.fdopen(os.dup(1), "w", buffering=1, encoding="utf-8")
os.dup2(2, 1)
sys.stdout = sys.stderr

sys.argv = ["amethyst", "list-games"]
import cli  # noqa: E402  (installed alongside Amethyst)

cli._setup_path()

from Utils.games.discovery import discover_games  # noqa: E402

PROTOCOL = 1


class BridgeError(Exception):
    """An expected failure, shown to the user as-is (no traceback)."""


class Bridge:
    def __init__(self):
        self.games: dict = {}
        self._log: list[str] = []

    # ---------- helpers ----------

    def log(self, msg):
        self._log.append(str(msg))
        del self._log[:-200]

    def _game(self, name: str):
        if not self.games:
            self.games = discover_games()
        g = self.games.get(name)
        if g is None:
            low = name.lower()
            g = next((x for n, x in self.games.items()
                      if n.lower() == low or getattr(x, "game_id", "").lower() == low), None)
        if g is None:
            raise BridgeError(f"Unknown game: {name}")
        return g

    def _configured(self, name: str):
        g = self._game(name)
        if not g.is_configured():
            raise BridgeError(f"{g.name} isn't set up yet.")
        return g

    def _profile_dir(self, g, profile: str) -> Path:
        pdir = g.get_profile_root() / "profiles" / profile
        if not pdir.is_dir():
            raise BridgeError(f"Profile '{profile}' doesn't exist.")
        g.set_active_profile_dir(pdir)
        g.load_paths()
        return pdir

    @staticmethod
    def _profiles(g) -> list[str]:
        pdir = g.get_profile_root() / "profiles"
        if not pdir.is_dir():
            return []
        return sorted((p.name for p in pdir.iterdir() if p.is_dir()), key=str.lower)

    def _game_info(self, name, g) -> dict:
        info = {"name": name, "game_id": getattr(g, "game_id", "") or "",
                "steam_id": "", "configured": False, "profiles": [],
                "deploy_active": False, "deployed_profile": "",
                "active_profile": "",
                "has_plugins": bool(getattr(g, "plugin_extensions", None)),
                "loot": bool(getattr(g, "loot_sort_enabled", False))}
        try:
            info["steam_id"] = str(g.effective_steam_id() or g.steam_id or "")
        except Exception:
            info["steam_id"] = str(getattr(g, "steam_id", "") or "")
        try:
            info["configured"] = bool(g.is_configured())
        except Exception:
            pass
        if info["configured"]:
            try:
                info["profiles"] = self._profiles(g)
                info["deploy_active"] = bool(g.get_deploy_active())
                info["deployed_profile"] = g.get_last_deployed_profile() or ""
                info["active_profile"] = g.get_last_active_profile() or ""
            except Exception as e:
                self.log(f"{name}: {e}")
        return info

    # ---------- RPC: games & setup ----------

    def ping(self):
        return {"protocol": PROTOCOL}

    def list_games(self, rescan: bool = True):
        if rescan or not self.games:
            # Deploy/restore run in a separate CLI process, so state on disk may
            # have moved on; rediscovering is cheap and keeps us honest.
            self.games = discover_games()
        return [self._game_info(n, g) for n, g in sorted(self.games.items())]

    def detect_installed(self):
        """Unconfigured games installed through any launcher Amethyst knows
        (Steam, Heroic, Lutris, Faugus, Bottles, non-Steam shortcuts, standalone).

        Mirror of AddGameView._scan_installed_games (gui_qt/add_game_view.py):
        one InstalledIndex, then game_launchers() per game."""
        from Utils.launchers.installed import InstalledIndex
        if not self.games:
            self.games = discover_games()
        index = InstalledIndex(log=self.log)
        found = []
        for name, g in sorted(self.games.items()):
            try:
                if g.is_configured():
                    continue
                launchers = index.game_launchers(g)
            except Exception as e:
                self.log(f"detect {name}: {e}")
                continue
            if launchers:
                found.append({"name": name, "launchers": list(launchers)})
        return found

    @staticmethod
    def _exe_names(g) -> list[str]:
        names = list(getattr(g, "configure_exe_names", []) or [])
        if not names:
            names = [getattr(g, "exe_name", None)] + list(getattr(g, "exe_name_alts", []) or [])
        return [n for n in names if n]

    @staticmethod
    def _heroic_app_names(g) -> list[str]:
        """Mirror of _heroic_app_names in gui_qt/configure_game_view.py."""
        names = list(getattr(g, "heroic_app_names", []) or [])
        if not names and getattr(g, "name", None):
            try:
                from Utils.config_paths import get_game_config_path
                p = get_game_config_path(g.name)
                if p.is_file():
                    data = json.loads(p.read_text(encoding="utf-8"))
                    saved = (data.get("heroic_app_name", "") or "").strip()
                    if saved:
                        names = [saved]
            except Exception:
                pass
        return names

    @staticmethod
    def _is_native_exe(exe) -> bool:
        """Mirror of _is_native_exe_name in gui_qt/configure_game_view.py."""
        return bool(exe) and Path(str(exe)).suffix.casefold() not in {
            ".exe", ".bat", ".cmd", ".com", ".msi"}

    def _install_candidates(self, g) -> list[dict]:
        """One candidate per launcher the game is installed through, best first.

        Mirror of ConfigureGameView._game_scan_worker (gui_qt/configure_game_view.py):
        same order (Heroic, Lutris, Faugus, Bottles, non-Steam shortcut, Steam),
        then a standalone install if nothing else matched."""
        out: list[dict] = []

        def add(source, path, prefix, launcher_id, exe=None):
            out.append({"source": source, "path": Path(path),
                        "prefix": Path(prefix) if prefix else None, "id": launcher_id,
                        "prefix_mode": ("native" if self._is_native_exe(exe)
                                        else "resolved" if prefix else "detect")})

        exe_names = self._exe_names(g)
        try:
            from Utils.launchers.heroic import (
                find_heroic_game_info_by_app_names, find_heroic_game_info_by_exe)
            heroic = self._heroic_app_names(g)
            if heroic:
                # Declared app names are authoritative; the GUI skips the exe scan.
                info = find_heroic_game_info_by_app_names(heroic)
                if info:
                    add("heroic", *info)
            else:
                for exe in exe_names:
                    info = find_heroic_game_info_by_exe(exe)
                    if info:
                        add("heroic", *info, exe)
                        break
            from Utils.launchers.lutris import find_lutris_game_info_by_exe
            for exe in exe_names:
                info = find_lutris_game_info_by_exe(exe)
                if info:
                    add("lutris", *info, exe)
                    break
            from Utils.launchers.faugus import find_faugus_game_info_by_exe
            for exe in exe_names:
                info = find_faugus_game_info_by_exe(exe)
                if info:
                    add("faugus", *info, exe)
                    break
            from Utils.launchers.bottles import find_bottles_game_info_by_exes
            info = find_bottles_game_info_by_exes(exe_names)
            if info:
                add("bottles", *info)
            from Utils.launchers.steam_shortcuts import find_shortcut_game_info_by_exe
            for exe in exe_names:
                info = find_shortcut_game_info_by_exe(exe)
                if info:
                    add("shortcut", *info, exe)
                    break
            sid = str(getattr(g, "steam_id", "") or "")
            if sid:
                from Utils.launchers.steam import (
                    find_steam_libraries, find_game_by_steam_id, find_game_in_libraries)
                libs = find_steam_libraries()
                found = matched = None
                for exe in exe_names:
                    found = find_game_by_steam_id(libs, sid, exe)
                    if found:
                        matched = exe
                        break
                if not found:
                    for exe in exe_names:
                        found = find_game_in_libraries(libs, exe)
                        if found:
                            matched = exe
                            break
                if found:
                    add("steam", found, None, None, matched)
        except Exception as e:
            traceback.print_exc()
            self.log(f"install scan failed: {e}")
        if not out:
            try:
                detect = getattr(g, "detect_standalone_install", None)
                found = detect() if callable(detect) else None
                if found is not None:
                    add("standalone", found, None, None, getattr(g, "exe_name", None))
            except Exception as e:
                self.log(f"standalone detection failed: {e}")
        return out

    def _find_prefix(self, g, game_path, source, launcher_id):
        """Mirror of ConfigureGameView._prefix_scan_worker: look for the prefix
        through the launcher the install came from (any launcher if None)."""
        exe_names = [e for e in [getattr(g, "exe_name", None)]
                     + list(getattr(g, "exe_name_alts", []) or []) if e]
        try:
            from Utils.launchers.steam import find_prefix
            from Utils.launchers.heroic import find_heroic_prefix
            ids = [getattr(g, "steam_id", None)] + [
                str(s) for s in getattr(g, "alt_steam_ids", []) or [] if s]
            try:
                saved = g.get_shortcut_appid() or ""
            except AttributeError:
                saved = ""
            if source == "shortcut" and launcher_id:
                ids = [launcher_id]
            elif saved:
                ids.insert(0, saved)
            if source in (None, "steam", "shortcut"):
                for s in [x for x in ids if x]:
                    found = find_prefix(s, game_path)
                    if found:
                        return found
            if source in (None, "heroic"):
                found = find_heroic_prefix([str(launcher_id)] if launcher_id
                                           else self._heroic_app_names(g))
                if found:
                    return found
            for src, mod, fn in (("lutris", "Utils.launchers.lutris", "find_lutris_game_info_by_exe"),
                                 ("faugus", "Utils.launchers.faugus", "find_faugus_game_info_by_exe"),
                                 ("shortcut", "Utils.launchers.steam_shortcuts", "find_shortcut_game_info_by_exe")):
                if source not in (None, src):
                    continue
                find = getattr(importlib.import_module(mod), fn)
                for exe in exe_names:
                    info = find(exe)
                    if info and info[1] is not None and (
                            not launcher_id or str(info[2]) == str(launcher_id)):
                        return info[1]
            if source in (None, "bottles"):
                from Utils.launchers.bottles import find_bottles_game_info_by_exes
                info = find_bottles_game_info_by_exes(
                    exe_names, game_path=game_path, program_id=launcher_id)
                if info:
                    return info[1]
        except Exception as e:
            self.log(f"prefix lookup failed: {e}")
        return None

    def configure_game(self, game: str, path: str = ""):
        """Same steps as Amethyst's Configure Game dialog with its auto-detect
        result applied (ConfigureGameView._apply_install_choice + _on_save):
        game path, Proton prefix, launcher ids, then the profile structure."""
        g = self._game(game)
        if path:
            c = {"source": "manual", "path": Path(path), "prefix": None,
                 "id": None, "prefix_mode": "detect"}
        else:
            cands = self._install_candidates(g)
            if not cands:
                raise BridgeError(f"Couldn't find {g.name} in Steam, Heroic, Lutris, Faugus, "
                                  "Bottles or your non-Steam shortcuts.")
            c = cands[0]  # the GUI auto-applies the first candidate
        target = c["path"]
        if not target.is_dir():
            raise BridgeError(f"Game folder not found: {target}")
        try:
            if g.is_configured() and g.get_deploy_active():
                raise BridgeError("Restore the game before changing where it's installed.")
        except BridgeError:
            raise
        except Exception:
            pass
        g.set_game_path(target)

        source = c["source"]
        # Which games get a prefix: the GUI's has_prefix_src (ConfigureGameView._build_paths_panel).
        uses_appimage = all(callable(getattr(g, n, None)) for n in (
            "get_appimage_path", "set_appimage_path", "detect_appimage", "scan_appimage"))
        has_prefix_src = not uses_appimage and hasattr(g, "set_prefix_path") and bool(
            getattr(g, "steam_id", None) or self._heroic_app_names(g)
            or source in ("heroic", "lutris", "faugus", "bottles", "shortcut"))
        prefix = None
        if has_prefix_src and c["prefix_mode"] != "native":
            prefix = c["prefix"] or self._find_prefix(
                g, target, None if source == "manual" else source, c["id"])
            if prefix:
                g.set_prefix_path(prefix)
        if source != "manual" and hasattr(g, "set_launcher_ids"):
            # "" clears the launchers that lost, like _apply_install_choice.
            keys = {"heroic": "heroic_app_name", "lutris": "lutris_slug",
                    "faugus": "faugus_gameid", "bottles": "bottles_program",
                    "shortcut": "shortcut_appid"}
            g.set_launcher_ids(**{k: (str(c["id"] or "") if source == s else "")
                                  for s, k in keys.items()})

        from Utils.profiles.structure import create_profile_structure
        create_profile_structure(g)
        return {"configured": bool(g.is_configured()), "path": str(target),
                "prefix": str(prefix) if prefix else "", "source": source,
                # Proton games need the prefix; the launcher only creates it on first launch.
                "needs_first_launch": has_prefix_src and c["prefix_mode"] != "native" and prefix is None}

    def create_profile(self, game: str, name: str):
        g = self._configured(game)
        name = name.strip()
        if not name or "/" in name or name in (".", ".."):
            raise BridgeError("Invalid profile name.")
        pdir = g.get_profile_root() / "profiles" / name
        if pdir.exists():
            raise BridgeError(f"Profile '{name}' already exists.")
        pdir.mkdir(parents=True)
        (pdir / "plugins.txt").touch()
        from Utils.mods.modlist import sync_modlist_with_mods_folder
        sync_modlist_with_mods_folder(pdir / "modlist.txt", g.get_mod_staging_path())
        return {"profiles": self._profiles(g)}

    # ---------- RPC: mods ----------

    def _modlist(self, g, profile):
        pdir = self._profile_dir(g, profile)
        from Utils.mods.modlist import read_modlist, sync_modlist_with_mods_folder
        path = pdir / "modlist.txt"
        try:
            sync_modlist_with_mods_folder(path, g.get_mod_staging_path())
        except Exception as e:
            self.log(f"modlist sync: {e}")
        return pdir, path, read_modlist(path)

    @staticmethod
    def _mod_rows(entries):
        return [{"name": e.name, "label": e.display_name, "enabled": e.enabled,
                 "locked": e.locked, "separator": e.is_separator}
                for e in entries if not e.is_group_header]

    def mods(self, game: str, profile: str):
        g = self._configured(game)
        _, _, entries = self._modlist(g, profile)
        return self._mod_rows(entries)

    def set_mod_enabled(self, game: str, profile: str, name: str, enabled: bool):
        g = self._configured(game)
        pdir, path, entries = self._modlist(g, profile)
        from Utils.mods.modlist import modlist_lock, write_modlist
        hit = next((e for e in entries if e.name == name), None)
        if hit is None or hit.is_separator:
            raise BridgeError(f"No mod named {name}.")
        if hit.locked:
            raise BridgeError(f"{hit.display_name} is locked.")
        if hit.enabled != enabled:
            with modlist_lock(path):
                hit.enabled = enabled
                write_modlist(path, entries)
            if getattr(g, "plugin_extensions", None):
                from Utils.plugins.sync import sync_plugins_for_mods
                try:
                    sync_plugins_for_mods(g, pdir, g.get_mod_staging_path(),
                                          [(name, enabled)], log_fn=self.log)
                except Exception as e:
                    self.log(f"plugin sync: {e}")
        return self._mod_rows(entries)

    def move_mod(self, game: str, profile: str, name: str, to_index: int):
        g = self._configured(game)
        _, path, entries = self._modlist(g, profile)
        from Utils.mods.modlist import modlist_lock, write_modlist
        rows = [e for e in entries if not e.is_group_header]
        idx = next((i for i, e in enumerate(rows) if e.name == name), None)
        if idx is None:
            raise BridgeError(f"No mod named {name}.")
        to_index = max(0, min(int(to_index), len(rows) - 1))
        if to_index != idx:
            with modlist_lock(path):
                rows.insert(to_index, rows.pop(idx))
                write_modlist(path, rows)
        return self._mod_rows(rows)

    # ---------- RPC: plugins ----------

    def _snapshot(self, g, pdir: Path):
        """A current Filegraph snapshot (which mod wins each file), the same
        input the GUI gives its plugin loader and LOOT. Without it, master
        and load-order checks can't resolve plugin files."""
        from Utils.filegraph.service import FileGraphService
        library = FileGraphService.open_library(g, pdir, log_fn=self.log)
        if not library.status().ready:
            library.refresh(pdir)
        session = library.open_profile(pdir)
        session.reconcile(operation_hint={"kind": "full"})
        return session.snapshot()

    def _plugin_rows(self, g, profile, snapshot=None):
        pdir = self._profile_dir(g, profile)
        if snapshot is None:
            try:
                snapshot = self._snapshot(g, pdir)
            except Exception as e:
                self.log(f"filegraph snapshot failed: {e}")
        from gui_qt.plugin_state import load_plugins
        rows = load_plugins(g, profile, snapshot=snapshot, include_bos_sp=False)
        return rows or []

    @staticmethod
    def _plugin_json(rows):
        from gui_qt.plugin_state import PF_MISSING, PF_LATE, PF_MASTER, PF_ESL
        out = []
        for r in rows:
            out.append({"name": r.name, "enabled": r.enabled, "vanilla": r.vanilla,
                        "master": bool(r.flags & PF_MASTER),
                        "light": bool(r.flags & PF_ESL),
                        "missing_masters": list(r.missing_masters or [])
                        if r.flags & PF_MISSING else [],
                        "late_masters": list(r.late_masters or [])
                        if r.flags & PF_LATE else []})
        return out

    def plugins(self, game: str, profile: str):
        g = self._configured(game)
        if not getattr(g, "plugin_extensions", None):
            return []
        return self._plugin_json(self._plugin_rows(g, profile))

    def _save_plugin_rows(self, g, profile, rows):
        from gui_qt.plugin_state import (save_plugins, master_block_enabled,
                                         enforce_master_block)
        if master_block_enabled(g):
            rows, _ = enforce_master_block(rows)
        save_plugins(g, profile, rows)
        return self._plugin_json(self._plugin_rows(g, profile))

    def set_plugin_enabled(self, game: str, profile: str, name: str, enabled: bool):
        g = self._configured(game)
        rows = self._plugin_rows(g, profile)
        hit = next((r for r in rows if r.name.lower() == name.lower()), None)
        if hit is None:
            raise BridgeError(f"No plugin named {name}.")
        if hit.vanilla:
            raise BridgeError(f"{hit.name} is part of the base game.")
        hit.enabled = enabled
        return self._save_plugin_rows(g, profile, rows)

    def move_plugin(self, game: str, profile: str, name: str, to_index: int):
        g = self._configured(game)
        rows = self._plugin_rows(g, profile)
        idx = next((i for i, r in enumerate(rows) if r.name.lower() == name.lower()), None)
        if idx is None:
            raise BridgeError(f"No plugin named {name}.")
        if rows[idx].vanilla:
            raise BridgeError(f"{rows[idx].name} is part of the base game and can't move.")
        to_index = max(0, min(int(to_index), len(rows) - 1))
        moving = rows.pop(idx)
        rows.insert(to_index, moving)
        masters = {m.lower() for m in (moving.masters or [])}
        clash = [r.name for r in rows[to_index + 1:] if r.name.lower() in masters]
        if clash:
            raise BridgeError(f"{moving.name} needs {clash[0]} to load before it.")
        dependants = [r.name for r in rows[:to_index]
                      if moving.name.lower() in {m.lower() for m in (r.masters or [])}]
        if dependants:
            raise BridgeError(f"{dependants[0]} needs {moving.name} to load before it.")
        return self._save_plugin_rows(g, profile, rows)

    def loot_sort(self, game: str, profile: str):
        """Mirror of the GUI's Sort Plugins: build a fresh Filegraph snapshot,
        run LOOT, apply with the same lock/primary-order rules, save."""
        g = self._configured(game)
        if not getattr(g, "loot_sort_enabled", False):
            raise BridgeError("LOOT sorting isn't supported for this game.")
        from LOOT.loot_sorter import is_available, unavailable_reason, sort_plugins
        if not is_available():
            raise BridgeError(f"LOOT isn't available: {unavailable_reason() or 'unknown reason'}")
        pdir = self._profile_dir(g, profile)
        snapshot = self._snapshot(g, pdir)
        rows = self._plugin_rows(g, profile, snapshot)
        if not rows:
            raise BridgeError("No plugins to sort.")

        from Utils.filegraph.service import plugin_source_paths
        from LOOT.game_view import ProfileSources

        userlist = pdir / "userlist.yaml"
        if not userlist.is_file():
            try:
                from Utils.config_paths import get_loot_game_dir
                userlist = get_loot_game_dir(g.game_id) / "userlist.yaml"
            except Exception:
                userlist = None
        userlist = userlist if userlist and userlist.is_file() else None

        lines: list[str] = []
        result = sort_plugins(
            plugin_names=[r.name for r in rows],
            enabled_set={r.name for r in rows if r.enabled},
            game_name=g.name, game_path=g.get_game_path(),
            staging_root=g.get_effective_mod_staging_path(),
            game_type_attr=getattr(g, "loot_game_type", ""), game_id=g.game_id,
            masterlist_url=getattr(g, "loot_masterlist_url", ""),
            masterlist_repo=getattr(g, "loot_masterlist_repo", ""),
            game_data_dir=(g.get_vanilla_plugins_path()
                           if hasattr(g, "get_vanilla_plugins_path") else None),
            userlist_path=userlist,
            plugin_winner_paths=plugin_source_paths(snapshot, g),
            profile_sources=ProfileSources.from_game(snapshot, g),
            locked_positions={}, refresh_only=False,
            log_fn=lambda m: (lines.append(str(m)), self.log(m)))

        try:
            from LOOT.loot_sorter import write_loot_info
            write_loot_info(pdir, result.plugin_info, result.general_messages,
                            game_id=g.game_id)
        except Exception as e:
            self.log(f"loot.json: {e}")

        from gui_qt.plugin_state import apply_loot_sort
        from Utils.plugins import enforce_primary_plugin_order
        new_rows, moved = apply_loot_sort(
            rows, {}, list(result.sorted_names),
            bool(getattr(g, "plugins_include_vanilla", False)))
        new_rows, _ = enforce_primary_plugin_order(g, new_rows)
        plugins = self._save_plugin_rows(g, profile, new_rows)
        return {"moved": moved, "warnings": list(getattr(result, "warnings", []) or []),
                "plugins": plugins, "log": lines[-20:]}

    def recent_log(self):
        return self._log[-50:]


def main():
    bridge = Bridge()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            method = req.get("method", "")
            if method.startswith("_") or not callable(getattr(bridge, method, None)):
                raise BridgeError(f"Unknown method {method}")
            result = getattr(bridge, method)(**(req.get("params") or {}))
            resp = {"id": rid, "result": result}
        except BridgeError as e:
            resp = {"id": rid, "error": str(e)}
        except Exception as e:
            traceback.print_exc()
            resp = {"id": rid, "error": f"{type(e).__name__}: {e}"}
        _rpc.write(json.dumps(resp, default=str) + "\n")
        _rpc.flush()


if __name__ == "__main__":
    _rpc.write(json.dumps({"id": None, "result": {"ready": True, "protocol": PROTOCOL}}) + "\n")
    _rpc.flush()
    main()
