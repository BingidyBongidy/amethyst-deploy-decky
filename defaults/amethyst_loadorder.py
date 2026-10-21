"""Load order RPCs (the Load order tab, for games whose handler has plugin files): list plugins,
enable/disable and move them, sort with LOOT, and check where the base game's
plugins should be. Uses the same Qt-free code as Amethyst's GUI."""
from __future__ import annotations

from pathlib import Path

from amethyst_rpc import BridgeError, Context


def _plugin_json(rows) -> list[dict]:
    from gui_qt.plugin_state import PF_ESL, PF_LATE, PF_MASTER, PF_MISSING
    return [{"name": r.name, "enabled": r.enabled, "vanilla": r.vanilla,
             "master": bool(r.flags & PF_MASTER), "light": bool(r.flags & PF_ESL),
             "missing_masters": list(r.missing_masters or []) if r.flags & PF_MISSING else [],
             "late_masters": list(r.late_masters or []) if r.flags & PF_LATE else []}
            for r in rows]


def _find_plugin(rows, name: str) -> int:
    index = next((i for i, r in enumerate(rows) if r.name.lower() == name.lower()), None)
    if index is None:
        raise BridgeError(f"No plugin named {name}.")
    return index


def _check_masters(rows, index: int) -> None:
    """Refuse a move that puts a plugin above its masters, or below a plugin
    that needs it, like the GUI does."""
    moving = rows[index]
    masters = {m.lower() for m in (moving.masters or [])}
    clash = [r.name for r in rows[index + 1:] if r.name.lower() in masters]
    if clash:
        raise BridgeError(f"{moving.name} needs {clash[0]} to load before it.")
    dependants = [r.name for r in rows[:index]
                  if moving.name.lower() in {m.lower() for m in (r.masters or [])}]
    if dependants:
        raise BridgeError(f"{dependants[0]} needs {moving.name} to load before it.")


def _folder_listing(folder, limit=40) -> list[str]:
    try:
        return sorted(p.name + ("/" if p.is_dir() else "") for p in folder.iterdir())[:limit]
    except (OSError, AttributeError):
        return []


class LoadOrderRpc:
    def __init__(self, ctx: Context):
        self.ctx = ctx

    # ---------------------------------------------------------------- reading

    def _snapshot(self, g, pdir: Path):
        """A current Filegraph snapshot (which mod wins each file), the same
        input the GUI gives its plugin loader and LOOT. Without it, master
        and load-order checks can't resolve plugin files."""
        from Utils.filegraph.service import FileGraphService
        library = FileGraphService.open_library(g, pdir, log_fn=self.ctx.log)
        if not library.status().ready:
            library.refresh(pdir)
        session = library.open_profile(pdir)
        session.reconcile(operation_hint={"kind": "full"})
        return session.snapshot()

    def _rows(self, g, profile, snapshot=None):
        from gui_qt.plugin_state import load_plugins
        pdir = self.ctx.profile_dir(g, profile)
        if snapshot is None:
            try:
                snapshot = self._snapshot(g, pdir)
            except Exception as e:
                self.ctx.log(f"filegraph snapshot failed: {e}")
        return load_plugins(g, profile, snapshot=snapshot, include_bos_sp=False) or []

    def _save(self, g, profile, rows):
        from gui_qt.plugin_state import enforce_master_block, master_block_enabled, save_plugins
        if master_block_enabled(g):
            rows, _ = enforce_master_block(rows)
        save_plugins(g, profile, rows)
        return _plugin_json(self._rows(g, profile))

    def plugins(self, game: str, profile: str):
        g = self.ctx.configured(game)
        if not getattr(g, "plugin_extensions", None):
            return []
        return _plugin_json(self._rows(g, profile))

    def game_folder_check(self, game: str):
        """Where Amethyst looks for the base game's plugins, and what's there.
        The Load order tab shows this when no base-game plugins were found
        (saved game folder wrong, or its Data folder spelled differently)."""
        g = self.ctx.configured(game)
        root = g.get_game_path()
        data = g.get_vanilla_plugins_path() if hasattr(g, "get_vanilla_plugins_path") else None
        info = {"game_path": str(root or ""), "data_path": str(data or ""),
                "data_exists": bool(data and data.is_dir()),
                "expected": list(getattr(g, "vanilla_plugins", []) or []),
                "game_folder": _folder_listing(root), "data_folder": _folder_listing(data)}
        self.ctx.log(f"game folder check: {g.name}: {info}")
        return info

    # ---------------------------------------------------------------- editing

    def set_plugin_enabled(self, game: str, profile: str, name: str, enabled: bool):
        g = self.ctx.configured(game)
        rows = self._rows(g, profile)
        plugin = rows[_find_plugin(rows, name)]
        if plugin.vanilla:
            raise BridgeError(f"{plugin.name} is part of the base game.")
        plugin.enabled = enabled
        return self._save(g, profile, rows)

    def move_plugin(self, game: str, profile: str, name: str, to_index: int):
        g = self.ctx.configured(game)
        rows = self._rows(g, profile)
        index = _find_plugin(rows, name)
        if rows[index].vanilla:
            raise BridgeError(f"{rows[index].name} is part of the base game and can't move.")
        to_index = max(0, min(int(to_index), len(rows) - 1))
        rows.insert(to_index, rows.pop(index))
        _check_masters(rows, to_index)
        return self._save(g, profile, rows)

    # ---------------------------------------------------------------- LOOT

    def loot_sort(self, game: str, profile: str):
        """Mirror of the GUI's Sort Plugins: build a fresh Filegraph snapshot,
        run LOOT, apply with the same lock/primary-order rules, save."""
        g = self.ctx.configured(game)
        if not getattr(g, "loot_sort_enabled", False):
            raise BridgeError("LOOT sorting isn't supported for this game.")
        from LOOT.loot_sorter import is_available, unavailable_reason
        if not is_available():
            raise BridgeError(f"LOOT isn't available: {unavailable_reason() or 'unknown reason'}")
        pdir = self.ctx.profile_dir(g, profile)
        snapshot = self._snapshot(g, pdir)
        rows = self._rows(g, profile, snapshot)
        if not rows:
            raise BridgeError("No plugins to sort.")
        lines: list[str] = []
        result = self._run_loot(g, pdir, rows, snapshot, lines)
        self._write_loot_info(g, pdir, result)

        from gui_qt.plugin_state import apply_loot_sort
        from Utils.plugins import enforce_primary_plugin_order
        new_rows, moved = apply_loot_sort(rows, {}, list(result.sorted_names),
                                          bool(getattr(g, "plugins_include_vanilla", False)))
        new_rows, _ = enforce_primary_plugin_order(g, new_rows)
        return {"moved": moved, "warnings": list(getattr(result, "warnings", []) or []),
                "plugins": self._save(g, profile, new_rows), "log": lines[-20:]}

    def _run_loot(self, g, pdir, rows, snapshot, lines: list[str]):
        from LOOT.game_view import ProfileSources
        from LOOT.loot_sorter import sort_plugins
        from Utils.filegraph.service import plugin_source_paths

        def log(message):
            lines.append(str(message))
            self.ctx.log(message)

        return sort_plugins(
            plugin_names=[r.name for r in rows],
            enabled_set={r.name for r in rows if r.enabled},
            game_name=g.name, game_path=g.get_game_path(),
            staging_root=g.get_effective_mod_staging_path(),
            game_type_attr=getattr(g, "loot_game_type", ""), game_id=g.game_id,
            masterlist_url=getattr(g, "loot_masterlist_url", ""),
            masterlist_repo=getattr(g, "loot_masterlist_repo", ""),
            game_data_dir=(g.get_vanilla_plugins_path()
                           if hasattr(g, "get_vanilla_plugins_path") else None),
            userlist_path=self._userlist(g, pdir),
            plugin_winner_paths=plugin_source_paths(snapshot, g),
            profile_sources=ProfileSources.from_game(snapshot, g),
            locked_positions={}, refresh_only=False, log_fn=log)

    @staticmethod
    def _userlist(g, pdir: Path):
        """The profile's LOOT userlist.yaml, else the game-wide one, else None."""
        userlist = pdir / "userlist.yaml"
        if not userlist.is_file():
            try:
                from Utils.config_paths import get_loot_game_dir
                userlist = get_loot_game_dir(g.game_id) / "userlist.yaml"
            except Exception:
                return None
        return userlist if userlist.is_file() else None

    def _write_loot_info(self, g, pdir, result) -> None:
        try:
            from LOOT.loot_sorter import write_loot_info
            write_loot_info(pdir, result.plugin_info, result.general_messages, game_id=g.game_id)
        except Exception as e:
            self.ctx.log(f"loot.json: {e}")
