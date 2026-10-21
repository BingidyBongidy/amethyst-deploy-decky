"""Free-account Nexus flow (Nexus.manual_install) with a stubbed Nexus API: the
task returns the file's download page, waits, and installs once the archive
lands in Downloads, with the Nexus ids in meta.ini.

Runs in-process (not through the bridge) so the Nexus API can be stubbed.
Run after make_fake_home.sh and bridge_smoke.py:
    AMETHYST_SRC=../amethyst/src python3 tests/manual_download_check.py
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
import threading
import time
import zipfile
from pathlib import Path

os.environ["HOME"] = "/tmp/bhome"
DEFAULTS = Path(__file__).resolve().parent.parent / "defaults"
sys.path[:0] = [os.environ["AMETHYST_SRC"], str(DEFAULTS)]
os.chdir(os.environ["AMETHYST_SRC"])
sys.argv = ["amethyst", "list-games"]
import cli  # Amethyst's CLI module sets up its import paths

cli._setup_path()
from amethyst_sources import Nexus
from amethyst_tasks import Task, TaskManager
from Nexus.nexus_api import NexusModFile, NexusModFiles, NexusModInfo
from Utils.games.discovery import discover_games

MOD_ID, FILE_ID = 300, 3000
ARCHIVE_NAME = "Late Mod-300-1-0.zip"


def make_archive() -> Path:
    path = Path(tempfile.mkdtemp()) / "late.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("textures/late.dds", b"DDS late")
    return path


class StubNexusApi:
    """Answers the two lookups manual_install makes."""

    def __init__(self, archive: Path):
        self.info = NexusModInfo(mod_id=MOD_ID, name="Late Mod", summary="", description="",
                                 version="1", author="me", category_id=0, game_id=1704,
                                 domain_name="skyrimspecialedition")
        self.file = NexusModFile(file_id=FILE_ID, name="Late Mod", version="1",
                                 category_name="MAIN", file_name=ARCHIVE_NAME,
                                 size_in_bytes=archive.stat().st_size)

    def get_mod(self, domain, mod_id):
        return self.info

    def get_mod_files(self, domain, mod_id):
        return NexusModFiles(files=[self.file])


def wait_while_working(task: Task, seconds: float = 60) -> None:
    deadline = time.time() + seconds
    while task.state == "working" and time.time() < deadline:
        time.sleep(0.5)


def main():
    game = discover_games()["Skyrim Special Edition"]
    profile_dir = game.get_profile_root() / "profiles" / "default"
    download = Path.home() / "Downloads" / ARCHIVE_NAME
    download.unlink(missing_ok=True)
    shutil.rmtree(game.get_mod_staging_path() / "Late Mod", ignore_errors=True)  # earlier run
    archive = make_archive()

    nexus = Nexus(lambda *_: None, print)
    nexus._api = StubNexusApi(archive)
    task = Task(TaskManager(lambda *_: None, print), "nexus", "Late Mod", game.name, "default")
    url: dict = {}
    url_ready = threading.Event()

    def on_url(page):
        url["page"] = page
        url_ready.set()

    task.mgr.start(task, lambda t: nexus.manual_install(
        t, game, profile_dir, MOD_ID, FILE_ID, threading.RLock(), on_url))
    assert url_ready.wait(30), "no download page URL"
    assert url["page"].endswith(f"/skyrimspecialedition/mods/{MOD_ID}?tab=files&file_id={FILE_ID}")

    time.sleep(1.5)
    assert task.state == "working", "the task should wait for the download"
    shutil.copy(archive, download)   # the "browser download" lands
    wait_while_working(task)
    assert task.state == "done", task.error

    meta = (game.get_mod_staging_path() / task.result["installed"][0] / "meta.ini").read_text()
    assert f"modid = {MOD_ID}" in meta and f"fileid = {FILE_ID}" in meta, meta
    print("manual download check passed")


if __name__ == "__main__":
    main()
