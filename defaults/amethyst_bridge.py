"""Amethyst bridge - runs INSIDE Amethyst's Flatpak python, started by the plugin.

Line-delimited JSON-RPC over stdin/stdout:
    request : {"id": 1, "method": "mods", "params": {...}}
    response: {"id": 1, "result": ...}  or  {"id": 1, "error": "message"}

Calls Amethyst's own modules (the same ones its GUI uses) so the controller UI
behaves identically: modlist.txt, plugins.txt/loadorder.txt, LOOT, game setup.
Anything Amethyst prints goes to stderr; stdout carries only responses.
"""
from __future__ import annotations

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
        """Unconfigured games that are installed through Steam (path found)."""
        from Utils.launchers.steam import find_steam_libraries
        libs = find_steam_libraries()
        if not self.games:
            self.games = discover_games()
        found = []
        for name, g in sorted(self.games.items()):
            try:
                if g.is_configured():
                    continue
            except Exception:
                continue
            path = self._find_steam_install(g, libs)
            if path:
                found.append({"name": name, "path": str(path)})
        return found

    @staticmethod
    def _exe_names(g) -> list[str]:
        names = list(getattr(g, "configure_exe_names", []) or [])
        if not names:
            names = [getattr(g, "exe_name", None)] + list(getattr(g, "exe_name_alts", []) or [])
        return [n for n in names if n]

    def _find_steam_install(self, g, libs):
        from Utils.launchers.steam import find_game_by_steam_id
        sid = str(getattr(g, "steam_id", "") or "")
        if not sid or not libs:
            return None
        for exe in self._exe_names(g):
            try:
                hit = find_game_by_steam_id(libs, sid, exe)
            except Exception:
                hit = None
            if hit:
                return Path(hit)
        return None

    def configure_game(self, game: str, path: str = ""):
        """Same steps as Amethyst's Configure Game dialog for a Steam install:
        game path, Proton prefix, then the profile folder structure."""
        g = self._game(game)
        if path:
            target = Path(path)
        else:
            from Utils.launchers.steam import find_steam_libraries
            target = self._find_steam_install(g, find_steam_libraries())
            if target is None:
                raise BridgeError(f"Couldn't find {g.name} in your Steam libraries.")
        if not target.is_dir():
            raise BridgeError(f"Game folder not found: {target}")
        g.set_game_path(target)
        sid = str(getattr(g, "steam_id", "") or "")
        prefix = None
        if sid and hasattr(g, "set_prefix_path"):
            try:
                from Utils.launchers.steam import find_prefix
                prefix = find_prefix(sid, target)
                if prefix:
                    g.set_prefix_path(prefix)
            except Exception as e:
                self.log(f"prefix lookup failed: {e}")
        from Utils.profiles.structure import create_profile_structure
        create_profile_structure(g)
        return {"configured": bool(g.is_configured()), "path": str(target),
                "prefix": str(prefix) if prefix else "",
                # Proton games need the prefix; Steam only creates it on first launch.
                "needs_first_launch": bool(sid) and prefix is None}

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
