"""Setup RPCs: list games, find installed ones, set a game up, pick its folder,
create profiles. The Setup tab and the page header use these."""
from __future__ import annotations

from pathlib import Path

import amethyst_detect as detect
import amethyst_gameroot as gameroot
import amethyst_unifideck as unifideck
from amethyst_rpc import BridgeError, Context, unlocked
from amethyst_sources import nexus_domain, ts_community

# Launcher id each install source saves in Amethyst's game config.
_LAUNCHER_ID_KEYS = {"heroic": "heroic_app_name", "lutris": "lutris_slug",
                     "faugus": "faugus_gameid", "bottles": "bottles_program",
                     "shortcut": "shortcut_appid"}
_PREFIX_SOURCES = ("heroic", "lutris", "faugus", "bottles", "shortcut", "unifideck")


class SetupRpc:
    def __init__(self, ctx: Context):
        self.ctx = ctx

    # ---------------------------------------------------------------- games

    def list_games(self, rescan: bool = True):
        games = self.ctx.rescan() if rescan else self.ctx.all_games()
        return [self._game_info(name, g) for name, g in sorted(games.items())]

    def _game_info(self, name, g) -> dict:
        info = {"name": name, "game_id": getattr(g, "game_id", "") or "",
                "steam_id": "", "configured": False, "profiles": [],
                "deploy_active": False, "deployed_profile": "", "active_profile": "",
                "has_plugins": bool(getattr(g, "plugin_extensions", None)),
                "loot": bool(getattr(g, "loot_sort_enabled", False)),
                "nexus_domain": nexus_domain(g), "ts_community": ts_community(g),
                "shortcut_appid": ""}
        try:
            info["steam_id"] = str(g.effective_steam_id() or g.steam_id or "")
        except Exception:
            info["steam_id"] = str(getattr(g, "steam_id", "") or "")
        try:
            info["configured"] = bool(g.is_configured())
        except Exception:
            pass
        if info["configured"]:
            self._add_profile_state(name, g, info)
        return info

    def _add_profile_state(self, name, g, info: dict) -> None:
        try:
            info["profiles"] = self.ctx.profiles(g)
            info["deploy_active"] = bool(g.get_deploy_active())
            info["deployed_profile"] = g.get_last_deployed_profile() or ""
            info["active_profile"] = g.get_last_active_profile() or ""
            # Non-Steam shortcut (incl. Unifideck): launch through it, not the store app.
            if hasattr(g, "get_shortcut_appid"):
                info["shortcut_appid"] = str(g.get_shortcut_appid() or "")
        except Exception as e:
            self.ctx.log(f"{name}: {e}")

    def detect_installed(self):
        """Unconfigured games installed through any launcher Amethyst knows
        (Steam, Heroic, Lutris, Faugus, Bottles, non-Steam shortcuts, standalone),
        plus Unifideck, which Amethyst doesn't know (see amethyst_unifideck.py).

        Mirror of AddGameView._scan_installed_games (gui_qt/add_game_view.py):
        one InstalledIndex, then game_launchers() per game."""
        from Utils.launchers.installed import InstalledIndex
        index = InstalledIndex(log=self.ctx.log)
        uni_rows = unifideck.load_rows()
        legendary = unifideck.legendary_installed() if uni_rows else {}
        self.ctx.log(f"detect: Unifideck games.map {unifideck.games_map_path()} -> "
                     f"{len(uni_rows)} rows; Legendary installs {len(legendary)}")
        found = []
        for name, g in sorted(self.ctx.all_games().items()):
            try:
                if g.is_configured():
                    continue
                launchers = list(index.game_launchers(g))
                if uni_rows and unifideck.find(detect.exe_names(g), detect.heroic_app_names(g),
                                               uni_rows, legendary, detect.base_plugin_markers(g)):
                    launchers.append("unifideck")
            except Exception as e:
                self.ctx.log(f"detect {name}: {e}")
                continue
            if launchers:
                found.append({"name": name, "launchers": launchers})
        summary = ", ".join(f"{f['name']} ({'/'.join(f['launchers'])})" for f in found)
        self.ctx.log(f"detect: found {summary or 'nothing'}")
        return found

    # ---------------------------------------------------------------- set up

    def configure_game(self, game: str, path: str = "", force: bool = False):
        """Same steps as Amethyst's Configure Game dialog with its auto-detect
        result applied (ConfigureGameView._apply_install_choice + _on_save):
        game path, Proton prefix, launcher ids, then the profile structure.

        Not in the GUI: the folder is checked first (see _check_folder). A folder
        chosen by hand (*path*) that doesn't look like the game returns
        {"needs_confirm": true, "message"} unless *force*."""
        g = self.ctx.game(game)
        candidate = self._pick_candidate(g, path)
        target, problem = self._check_folder(g, candidate, force)
        if problem:
            return problem
        try:
            if g.is_configured() and g.get_deploy_active():
                raise BridgeError("Restore the game before changing where it's installed.")
        except BridgeError:
            raise
        except Exception:
            pass
        g.set_game_path(target)
        prefix, uses_prefix = self._apply_prefix(g, candidate, target)
        self._save_launcher_ids(g, candidate)

        from Utils.profiles.structure import create_profile_structure
        create_profile_structure(g)
        native = candidate["prefix_mode"] == "native"
        return {"configured": bool(g.is_configured()), "path": str(target),
                "prefix": str(prefix) if prefix else "", "source": candidate["source"],
                # Proton games need the prefix; the launcher only creates it on first launch.
                "needs_first_launch": uses_prefix and not native and prefix is None}

    def _pick_candidate(self, g, path: str) -> dict:
        if path:
            return {"source": "manual", "path": Path(path), "prefix": None,
                    "id": None, "prefix_mode": "detect"}
        candidate = next(detect.install_candidates(g, self.ctx.log), None)
        if candidate is None:
            raise BridgeError(f"Couldn't find {g.name} in Steam, Heroic, Unifideck, Lutris, "
                              "Faugus, Bottles or your non-Steam shortcuts. "
                              "Choose its folder by hand instead.")
        return candidate

    def _check_folder(self, g, candidate: dict, force: bool):
        """(game folder, None), or (None, needs_confirm reply). A launcher's
        folder that doesn't hold the game is searched up to two levels down
        (stores nest games; Epic splits some by language)."""
        target = candidate["path"]
        if not target.is_dir():
            raise BridgeError(f"Game folder not found: {target}")
        markers = detect.game_markers(g)
        resolved, found = gameroot.resolve(target, markers)
        if found:
            if resolved != target:
                self.ctx.log(f"configure {g.name}: game files are in {resolved}, not {target}")
            return resolved, None
        wanted = ", ".join(markers[:4])
        if candidate["source"] != "manual":
            raise BridgeError(f"{g.name} was found through {candidate['source']} at {target}, "
                              f"but its files ({wanted}) aren't in that folder or the ones "
                              "below it. Choose the game folder by hand.")
        if force:
            return target, None
        return None, {"configured": False, "needs_confirm": True, "path": str(target),
                      "message": f"{target} doesn't look like {g.name}'s folder: "
                                 f"none of {wanted} is in it or the folders below it."}

    def _apply_prefix(self, g, candidate: dict, target: Path):
        """(prefix or None, whether this game uses one). Which games get a
        prefix: the GUI's has_prefix_src (ConfigureGameView._build_paths_panel)."""
        source = candidate["source"]
        uses_appimage = all(callable(getattr(g, n, None)) for n in (
            "get_appimage_path", "set_appimage_path", "detect_appimage", "scan_appimage"))
        uses_prefix = (not uses_appimage and hasattr(g, "set_prefix_path")
                       and bool(getattr(g, "steam_id", None) or detect.heroic_app_names(g)
                                or source in _PREFIX_SOURCES))
        if not uses_prefix or candidate["prefix_mode"] == "native":
            return None, uses_prefix
        prefix = candidate["prefix"] or detect.find_prefix(
            g, target, None if source == "manual" else source, candidate["id"], self.ctx.log)
        if prefix:
            g.set_prefix_path(prefix)
        return prefix, uses_prefix

    @staticmethod
    def _save_launcher_ids(g, candidate: dict) -> None:
        """Like _apply_install_choice: the winning launcher's id, "" for the rest."""
        if candidate["source"] == "manual" or not hasattr(g, "set_launcher_ids"):
            return
        # A Unifideck install is a non-Steam shortcut as far as Amethyst is concerned.
        source = "shortcut" if candidate["source"] == "unifideck" else candidate["source"]
        g.set_launcher_ids(**{key: (str(candidate["id"] or "") if source == s else "")
                              for s, key in _LAUNCHER_ID_KEYS.items()})

    # ---------------------------------------------------------------- folder picker

    @unlocked
    def browse_folders(self, path: str = "", game: str = ""):
        """For the Setup tab's folder picker. No *path*: starting places.
        Otherwise the folder's subfolders. With *game*, each folder says
        whether it looks like that game's root (has its exe or base-game files)."""
        markers = self._markers_for(game)
        if not path:
            return {"path": "", "parent": "", "looks_like_game": False,
                    "folders": _starting_places(markers, self.ctx.log)}
        folder = Path(path)
        if not folder.is_dir():
            raise BridgeError(f"Folder not found: {folder}")
        parent = str(folder.parent) if folder.parent != folder else ""
        return {"path": str(folder), "parent": parent,
                "looks_like_game": bool(markers) and gameroot.has_marker(folder, markers),
                "folders": [_folder_entry(d.name, d, markers) for d in gameroot.subdirs(folder)]}

    def _markers_for(self, game: str) -> list[str]:
        if not game:
            return []
        try:
            return detect.game_markers(self.ctx.game(game))
        except Exception:
            return []

    # ---------------------------------------------------------------- profiles

    def create_profile(self, game: str, name: str):
        g = self.ctx.configured(game)
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
        return {"profiles": self.ctx.profiles(g)}


def _folder_entry(name: str, folder: Path, markers: list[str]) -> dict:
    return {"name": name, "path": str(folder),
            "looks_like_game": bool(markers) and gameroot.has_marker(folder, markers)}


def _drives() -> list[Path]:
    """SD cards and USB drives. SteamOS mounts them at /run/media/<user>/<label>
    or /run/media/<label>."""
    home_name = Path.home().name
    drives = []
    for base in (Path("/run/media"), Path("/media"), Path("/mnt")):
        for d in gameroot.subdirs(base):
            inner = [x for x in gameroot.subdirs(d) if x.name != "lost+found"]
            drives += inner if d.name == home_name and inner else [d]
    return drives


def _starting_places(markers: list[str], log) -> list[dict]:
    """Home, drives, Steam libraries and ~/Games, the places games live."""
    home = Path.home()
    places = [_folder_entry("Home", home, markers)]
    places += [_folder_entry(f"Drive: {d.name}", d, markers) for d in _drives()]
    try:
        from Utils.launchers.steam import find_steam_libraries
        places += [_folder_entry(f"Steam library: {c}", Path(c), markers)
                   for c in find_steam_libraries()]
    except Exception as e:
        log(f"browse: steam libraries: {e}")
    games_dir = home / "Games"
    if games_dir.is_dir():
        places.append(_folder_entry(f"Games ({games_dir})", games_dir, markers))
    return [p for p in places if Path(p["path"]).is_dir()]
