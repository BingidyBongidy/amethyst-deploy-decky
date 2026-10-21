"""Mod list RPCs (the Mods tab): read, enable/disable, reorder and uninstall
mods in a profile's modlist.txt, through Amethyst's own modlist helpers."""
from __future__ import annotations

from amethyst_rpc import BridgeError, Context


def _rows(entries) -> list[dict]:
    """What the frontend shows; group headers are a GUI-only view."""
    return [{"name": e.name, "label": e.display_name, "enabled": e.enabled,
             "locked": e.locked, "separator": e.is_separator}
            for e in entries if not e.is_group_header]


def _find_mod(entries, name: str):
    hit = next((e for e in entries if e.name == name), None)
    if hit is None or hit.is_separator:
        raise BridgeError(f"No mod named {name}.")
    return hit


class ModlistRpc:
    def __init__(self, ctx: Context):
        self.ctx = ctx

    def _load(self, g, profile):
        """(profile folder, modlist.txt, entries), synced with the mods folder
        first, as the GUI does when it opens a profile."""
        from Utils.mods.modlist import read_modlist, sync_modlist_with_mods_folder
        pdir = self.ctx.profile_dir(g, profile)
        path = pdir / "modlist.txt"
        try:
            sync_modlist_with_mods_folder(path, g.get_mod_staging_path())
        except Exception as e:
            self.ctx.log(f"modlist sync: {e}")
        return pdir, path, read_modlist(path)

    def mods(self, game: str, profile: str):
        _, _, entries = self._load(self.ctx.configured(game), profile)
        return _rows(entries)

    def set_mod_enabled(self, game: str, profile: str, name: str, enabled: bool):
        from Utils.mods.modlist import modlist_lock, write_modlist
        g = self.ctx.configured(game)
        pdir, path, entries = self._load(g, profile)
        mod = _find_mod(entries, name)
        if mod.locked:
            raise BridgeError(f"{mod.display_name} is locked.")
        if mod.enabled == enabled:
            return _rows(entries)
        with modlist_lock(path):
            mod.enabled = enabled
            write_modlist(path, entries)
        if getattr(g, "plugin_extensions", None):
            self._sync_plugins(g, pdir, name, enabled)
        return _rows(entries)

    def _sync_plugins(self, g, pdir, name: str, enabled: bool) -> None:
        """Enable/disable the mod's plugins too, as the GUI does."""
        from Utils.plugins.sync import sync_plugins_for_mods
        try:
            sync_plugins_for_mods(g, pdir, g.get_mod_staging_path(), [(name, enabled)],
                                  log_fn=self.ctx.log)
        except Exception as e:
            self.ctx.log(f"plugin sync: {e}")

    def remove_mod(self, game: str, profile: str, name: str):
        """Uninstall a mod: Amethyst's full removal (Utils/mods/remove.py
        remove_mods: undeploy its files, drop its plugins, delete its staging
        folder and index rows), then drop its modlist row, which remove_mods
        leaves to the caller (as gui_qt/app.py does)."""
        from Utils.mods.remove import remove_mods
        from Utils.mods.modlist import modlist_lock, read_modlist, write_modlist
        g = self.ctx.configured(game)
        pdir, path, entries = self._load(g, profile)
        _find_mod(entries, name)
        remove_mods(g, pdir, [name], log_fn=self.ctx.log)
        with modlist_lock(path):
            rows = [e for e in read_modlist(path) if e.name != name]
            write_modlist(path, rows)
        return _rows(rows)

    def move_mod(self, game: str, profile: str, name: str, to_index: int):
        from Utils.mods.modlist import modlist_lock, write_modlist
        _, path, entries = self._load(self.ctx.configured(game), profile)
        rows = [e for e in entries if not e.is_group_header]
        index = next((i for i, e in enumerate(rows) if e.name == name), None)
        if index is None:
            raise BridgeError(f"No mod named {name}.")
        to_index = max(0, min(int(to_index), len(rows) - 1))
        if to_index != index:
            with modlist_lock(path):
                rows.insert(to_index, rows.pop(index))
                write_modlist(path, rows)
        return _rows(rows)
