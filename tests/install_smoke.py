"""Install smoke test: Install from Downloads (plain archive, already installed,
FOMOD, cancel), the Nexus login start, and a live Thunderstore install.

Run after make_fake_home.sh and bridge_smoke.py (which sets up Skyrim SE):
    AMETHYST_SRC=../amethyst/src python3 tests/install_smoke.py
SKIP_NETWORK=1 leaves out the Nexus and Thunderstore parts.
"""
from __future__ import annotations

import os
import socket

from bridge_client import STAGING, Bridge, run_checks

SKYRIM = "Skyrim Special Edition"
VALHEIM = "Valheim"
PROFILE = "default"
PLAIN = "Plain Mod-100-1-0.zip"
CHOICE = "Choice Mod-200-1-0.zip"   # FOMOD: Red (recommended) or Blue

bridge: Bridge  # set in main()


def archive_path(name: str) -> str:
    return next(a["path"] for a in bridge.call("local_archives") if a["name"] == name)


def start_install(name: str) -> dict:
    """Start installing a Downloads archive; the task once it stops working."""
    task = bridge.call("install_archive", game=SKYRIM, profile=PROFILE, path=archive_path(name))
    return bridge.wait_for_task(task["id"])


def answer(task: dict, value) -> dict:
    bridge.call("task_answer", task_id=task["id"], value=value)
    return bridge.wait_for_task(task["id"])


def staged_files(mod: str) -> list[str]:
    root = STAGING / SKYRIM / "mods" / mod
    return sorted(str(p.relative_to(root)) for p in root.rglob("*") if p.is_file())


# ---------------------------------------------------------------- Downloads


def downloads_lists_the_test_archives():
    names = [a["name"] for a in bridge.call("local_archives")]
    assert PLAIN in names and CHOICE in names, names


def plain_archive_installs_straight_away():
    task = start_install(PLAIN)
    assert task["state"] == "done", task
    installed = task["result"]["installed"][0]
    assert installed in [m["name"] for m in bridge.call("mods", game=SKYRIM, profile=PROFILE)]


def reinstall_asks_and_can_keep_both():
    task = start_install(PLAIN)
    assert task["state"] == "choice" and task["choice"]["kind"] == "exists", task
    task = answer(task, "rename")
    assert task["state"] == "done" and task["result"]["installed"] == ["Plain Mod (2)"], task


def fomod_installs_the_chosen_option():
    task = start_install(CHOICE)
    assert task["state"] == "choice" and task["choice"]["kind"] == "fomod", task
    view = bridge.call("fomod_view", task_id=task["id"])
    options = view["steps"][0]["groups"][0]["options"]
    assert [o["selected"] for o in options] == [True, False], options   # Red is recommended

    view = bridge.call("fomod_toggle", task_id=task["id"], step=view["steps"][0]["index"],
                       group=0, name="Blue")
    assert [o["selected"] for o in view["steps"][0]["groups"][0]["options"]] == [False, True]

    task = answer(task, "install")
    assert task["state"] == "done", task
    files = staged_files(task["result"]["installed"][0])
    assert "textures/blue.dds" in files and "textures/red.dds" not in files, files


def cancel_while_choosing():
    task = start_install(CHOICE)
    bridge.call("task_cancel", task_id=task["id"])
    task = bridge.wait_for_task(task["id"], until_finished=True)
    assert task["state"] == "cancelled", task


def only_downloads_can_be_installed():
    error = bridge.error("install_archive", game=SKYRIM, profile=PROFILE, path="/etc/passwd")
    assert "Downloads" in error, error


def progress_arrives_as_events():
    assert any(event["event"] == "task" for event in bridge.events)


# ---------------------------------------------------------------- network


def nexus_login_starts_amethysts_oauth():
    """The bridge returns the authorise page for Steam's browser, and Amethyst's
    callback listens on localhost:7890 for the redirect."""
    assert not bridge.call("nexus_status")["logged_in"]
    url = bridge.call("nexus_login_start")["url"]
    assert url.startswith("https://users.nexusmods.com/oauth/authorize?"), url
    assert "localhost%3A7890" in url, url
    socket.create_connection(("127.0.0.1", 7890), timeout=5).close()
    bridge.call("nexus_login_stop")
    assert "Log in" in bridge.error("nexus_mods", game=SKYRIM)


def thunderstore_installs_with_dependencies():
    assert bridge.call("configure_game", game=VALHEIM)["source"] == "steam"
    results = bridge.call("ts_mods", game=VALHEIM, query="jotunn")["mods"]
    jotunn = next(m for m in results if m["name"] == "Jotunn")
    task = bridge.call("ts_install", game=VALHEIM, profile=PROFILE,
                       namespace=jotunn["namespace"], name=jotunn["name"])
    task = bridge.wait_for_task(task["id"])
    if task["state"] == "choice":
        assert task["choice"]["kind"] == "deps", task
        task = answer(task, [d["id"] for d in task["choice"]["packages"]])
    assert task["state"] == "done", task

    installed = [m["name"] for m in bridge.call("mods", game=VALHEIM, profile=PROFILE)]
    assert "Jotunn" in installed and "BepInExPack_Valheim" in installed, installed
    meta = STAGING / VALHEIM / "mods" / task["result"]["installed"][-1] / "meta.ini"
    assert "thunderstore" in meta.read_text().lower()


def main():
    global bridge
    checks = [downloads_lists_the_test_archives, plain_archive_installs_straight_away,
              reinstall_asks_and_can_keep_both, fomod_installs_the_chosen_option,
              cancel_while_choosing, only_downloads_can_be_installed, progress_arrives_as_events]
    if not os.environ.get("SKIP_NETWORK"):
        checks += [nexus_login_starts_amethysts_oauth, thunderstore_installs_with_dependencies]
    with Bridge("/tmp/install_stderr.log") as bridge:
        assert bridge.game(SKYRIM)["configured"], "run bridge_smoke.py first"
        run_checks(checks)
    print("install smoke test passed")


if __name__ == "__main__":
    main()
