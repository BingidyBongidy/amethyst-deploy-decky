"""Bridge smoke test: detection and setup from every launcher, the folder picker,
the mod list, load order, profiles and error handling, against real Amethyst
source and the fake home from make_fake_home.sh.

    tests/make_fake_home.sh
    AMETHYST_SRC=../amethyst/src python3 tests/bridge_smoke.py

The checks run in order and build on each other (set up, then add mods, ...).
"""
from __future__ import annotations

import time

from bridge_client import FAKE_HOME, STAGING, Bridge, run_checks
from mkplugin import write_plugin

SKYRIM = "Skyrim Special Edition"
PROFILE = "default"
FALLOUT3_EPIC_ID = "adeae8bbfc94427db57c7dfecce3f1d4"
FALLOUT3_ROOT = FAKE_HOME / "Games" / "Epic" / "Fallout3"
SKYRIM_MODS = STAGING / SKYRIM / "mods"

bridge: Bridge  # set in main()


def mod_names(rows) -> list[str]:
    return [row["name"] for row in rows]


def detection_finds_every_launcher():
    found = {d["name"]: d["launchers"] for d in bridge.call("detect_installed")}
    assert found[SKYRIM] == ["steam"], found
    assert "heroic" in found["Fallout New Vegas"], found
    assert "unifideck" in found["Fallout 3"], found


def setup_through_heroic():
    result = bridge.call("configure_game", game="Fallout New Vegas")
    assert result["source"] == "heroic", result
    assert result["prefix"].endswith("Prefixes/1454587428/pfx"), result
    assert not result["needs_first_launch"], result
    assert bridge.game("Fallout New Vegas")["configured"]
    still_listed = mod_names(bridge.call("detect_installed"))
    assert "Fallout New Vegas" not in still_listed


def setup_through_unifideck_picks_the_language_folder():
    result = bridge.call("configure_game", game="Fallout 3")
    assert result["source"] == "unifideck", result
    assert result["prefix"].endswith(f"{FALLOUT3_EPIC_ID}/pfx"), result
    assert result["path"].endswith("Fallout 3 GOTY English"), result
    assert bridge.call("game_folder_check", game="Fallout 3")["data_exists"]
    shortcut = str(-123456789 & 0xFFFFFFFF)   # games.map stores it signed
    assert bridge.game("Fallout 3")["shortcut_appid"] == shortcut


def folder_picker_lists_places_and_marks_game_folders():
    places = bridge.call("browse_folders")["folders"]
    assert places[0]["name"] == "Home", places
    listing = bridge.call("browse_folders", path=str(FALLOUT3_ROOT), game="Fallout 3")
    assert not listing["looks_like_game"], listing
    assert any(folder["looks_like_game"] for folder in listing["folders"]), listing


def setup_by_hand_checks_the_folder():
    wrong = bridge.call("configure_game", game="Fallout 3", path=str(FAKE_HOME / "Downloads"))
    assert wrong["needs_confirm"] and not wrong["configured"], wrong

    started = time.time()
    too_big = bridge.call("configure_game", game="Fallout 3", path=str(FAKE_HOME))
    assert too_big["needs_confirm"], too_big
    assert time.time() - started < 10, "the folder search should stop at its budget"

    top = bridge.call("configure_game", game="Fallout 3", path=str(FALLOUT3_ROOT))
    assert top["configured"] and top["path"].endswith("Fallout 3 GOTY English"), top


def setup_through_steam():
    result = bridge.call("configure_game", game=SKYRIM)
    assert result["source"] == "steam", result
    assert result["prefix"].endswith("compatdata/489830/pfx"), result
    assert PROFILE in bridge.game(SKYRIM)["profiles"]


def mod_list_enables_and_moves_mods():
    # Install three mods by hand into staging, like Amethyst would.
    for mod, plugin, masters in [("Cool Mod", "CoolMod.esp", ["Skyrim.esm"]),
                                 ("Patch Pack", "CoolPatch.esp", ["Skyrim.esm", "CoolMod.esp"]),
                                 ("Textures HD", None, [])]:
        (SKYRIM_MODS / mod / "textures").mkdir(parents=True, exist_ok=True)
        if plugin:
            write_plugin(SKYRIM_MODS / mod / plugin, masters)
    assert sorted(mod_names(bridge.call("mods", game=SKYRIM, profile=PROFILE))) == [
        "Cool Mod", "Patch Pack", "Textures HD"]
    for mod in ["Cool Mod", "Patch Pack", "Textures HD"]:
        rows = bridge.call("set_mod_enabled", game=SKYRIM, profile=PROFILE, name=mod, enabled=True)
    assert all(row["enabled"] for row in rows), rows
    rows = bridge.call("move_mod", game=SKYRIM, profile=PROFILE, name="Textures HD", to_index=2)
    assert mod_names(rows)[2] == "Textures HD", rows


def load_order_follows_masters():
    plugins = bridge.call("plugins", game=SKYRIM, profile=PROFILE)
    vanilla = [p["name"] for p in plugins if p["vanilla"]]
    assert "Skyrim.esm" in vanilla and {"CoolMod.esp", "CoolPatch.esp"} <= set(mod_names(plugins))
    assert not any(p["missing_masters"] for p in plugins), plugins

    above_master = bridge.error("move_plugin", game=SKYRIM, profile=PROFILE,
                                name="CoolPatch.esp", to_index=0)
    assert "needs" in above_master, above_master
    below_patch = bridge.error("move_plugin", game=SKYRIM, profile=PROFILE,
                               name="CoolMod.esp", to_index=6)
    assert "needs" in below_patch, below_patch
    vanilla_move = bridge.error("move_plugin", game=SKYRIM, profile=PROFILE,
                                name="Skyrim.esm", to_index=3)
    assert "base game" in vanilla_move, vanilla_move

    rows = bridge.call("set_plugin_enabled", game=SKYRIM, profile=PROFILE,
                       name="CoolMod.esp", enabled=False)
    assert not next(p for p in rows if p["name"] == "CoolMod.esp")["enabled"]


def disabling_a_mod_drops_its_plugins():
    bridge.call("set_mod_enabled", game=SKYRIM, profile=PROFILE, name="Patch Pack", enabled=False)
    plugins = mod_names(bridge.call("plugins", game=SKYRIM, profile=PROFILE))
    assert "CoolPatch.esp" not in plugins, plugins


def uninstall_removes_the_mod():
    rows = bridge.call("remove_mod", game=SKYRIM, profile=PROFILE, name="Textures HD")
    assert "Textures HD" not in mod_names(rows), rows
    assert not (SKYRIM_MODS / "Textures HD").exists()


def base_game_check_finds_skyrim_esm():
    check = bridge.call("game_folder_check", game=SKYRIM)
    assert check["data_exists"] and "Skyrim.esm" in check["data_folder"], check


def profiles_are_created_once():
    assert "Survival" in bridge.call("create_profile", game=SKYRIM, name="Survival")["profiles"]
    assert "already exists" in bridge.error("create_profile", game=SKYRIM, name="Survival")


def loot_sorts_or_says_why_not():
    # LOOT needs libloot built for this Python; without it the bridge must say so.
    result, error = bridge.request("loot_sort", game=SKYRIM, profile=PROFILE)
    assert result or "LOOT" in error, (result, error)


def bad_requests_are_refused():
    assert "Unknown method" in bridge.error("_game", name="x")
    assert "Unknown method" in bridge.error("nope")
    assert "Unknown game" in bridge.error("mods", game="Nope", profile=PROFILE)


def main():
    global bridge
    with Bridge("/tmp/bridge_stderr.log") as bridge:
        run_checks([
            detection_finds_every_launcher,
            setup_through_heroic,
            setup_through_unifideck_picks_the_language_folder,
            folder_picker_lists_places_and_marks_game_folders,
            setup_by_hand_checks_the_folder,
            setup_through_steam,
            mod_list_enables_and_moves_mods,
            load_order_follows_masters,
            disabling_a_mod_drops_its_plugins,
            uninstall_removes_the_mod,
            base_game_check_finds_skyrim_esm,
            profiles_are_created_once,
            loot_sorts_or_says_why_not,
            bad_requests_are_refused,
        ])
    print("bridge smoke test passed")


if __name__ == "__main__":
    main()
