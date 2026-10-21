"""Install RPCs: background tasks and their prompts (FOMOD, BAIN, already
installed, dependencies), the Downloads tab, and the Get mods tab's Nexus and
Thunderstore calls. Installs run as tasks (amethyst_tasks); everything that
starts one returns the Task straight away."""
from __future__ import annotations

import os
import threading
from pathlib import Path

from amethyst_rpc import GAME_LOCK, BridgeError, Context, emit, unlocked
from amethyst_sources import Nexus, Thunderstore
from amethyst_tasks import (TERMINAL, Task, TaskManager, fomod_image, fomod_toggle,
                            fomod_view, install_archive_flow)


def _archive_dirs() -> list[Path]:
    """Amethyst's download locations: Downloads (unless disabled) plus the
    user's extra folders (Utils/downloads/locations.py)."""
    from Utils.downloads.locations import get_effective_download_locations
    return [Path(d) for d in get_effective_download_locations() if Path(d).is_dir()]


class InstallsRpc:
    def __init__(self, ctx: Context):
        self.ctx = ctx
        self.taskmgr = TaskManager(emit, ctx.log)
        self.nexus = Nexus(emit, ctx.log)
        self.thunderstore = Thunderstore(ctx.log)

    def _start(self, kind: str, title: str, game: str, profile: str, work):
        task = Task(self.taskmgr, kind, title, game, profile)
        return self.taskmgr.start(task, work)

    # ---------------------------------------------------------------- tasks

    @unlocked
    def tasks(self):
        return [t.public() for t in self.taskmgr.tasks.values()]

    @unlocked
    def task_answer(self, task_id: str, value=None):
        self.taskmgr.get(task_id).answer(value)
        return {}

    @unlocked
    def task_cancel(self, task_id: str):
        task = self.taskmgr.get(task_id)
        task.request_cancel()
        return task.public()

    @unlocked
    def fomod_view(self, task_id: str):
        return fomod_view(self.taskmgr.get(task_id))

    @unlocked
    def fomod_toggle(self, task_id: str, step: int, group: int, name: str):
        return fomod_toggle(self.taskmgr.get(task_id), step, group, name)

    @unlocked
    def fomod_image(self, task_id: str, step: int, group: int, name: str):
        return fomod_image(self.taskmgr.get(task_id), step, group, name)

    # ---------------------------------------------------------------- Downloads tab

    @unlocked
    def local_archives(self):
        """Archives ready to install, newest first. Like Amethyst's Downloads
        scan (Utils/downloads/core.py scan_download_dirs), 0-byte files are
        in-progress browser downloads and are skipped."""
        from Utils.downloads.core import is_archive
        found = []
        for folder in _archive_dirs():
            try:
                with os.scandir(folder) as entries:
                    for entry in entries:
                        if entry.is_file() and is_archive(entry.name):
                            found.append(self._archive_entry(entry, folder))
            except OSError as e:
                self.ctx.log(f"list {folder}: {e}")
        found = [a for a in found if a["size"]]
        found.sort(key=lambda a: -a["modified"])
        return found[:300]

    @staticmethod
    def _archive_entry(entry, folder: Path) -> dict:
        stat = entry.stat()
        return {"path": entry.path, "name": entry.name, "folder": str(folder),
                "size": stat.st_size, "modified": int(stat.st_mtime)}

    def install_archive(self, game: str, profile: str, path: str):
        archive = Path(path)
        if archive.parent not in _archive_dirs() or not archive.is_file():
            raise BridgeError("That file isn't in your Downloads folder any more.")
        g, pdir = self.ctx.target(game, profile)

        def work(task):
            name = install_archive_flow(task, g, pdir, archive, game_lock=GAME_LOCK)
            return {"installed": [name]}
        return self._start("archive", archive.name, game, profile, work)

    # ---------------------------------------------------------------- Nexus

    @unlocked
    def nexus_status(self, refresh: bool = False):
        return self.nexus.status(refresh)

    @unlocked
    def nexus_login_start(self):
        return self.nexus.start_login()

    @unlocked
    def nexus_login_stop(self):
        return self.nexus.stop_login()

    @unlocked
    def nexus_set_key(self, key: str):
        return self.nexus.use_key(key)

    @unlocked
    def nexus_logout(self):
        return self.nexus.logout()

    @unlocked
    def nexus_mods(self, game: str, query: str = "", sort: str = "downloads", page: int = 0):
        return self.nexus.mods(self.ctx.game(game), query, sort, page)

    @unlocked
    def nexus_mod(self, game: str, mod_id: int):
        return self.nexus.mod(self.ctx.game(game), mod_id)

    def nexus_install(self, game: str, profile: str, mod_id: int, file_id: int, title: str = ""):
        """Premium: download straight from Nexus, then install."""
        g, pdir = self.ctx.target(game, profile)

        def work(task):
            return self.nexus.download_install(task, g, pdir, mod_id, file_id, GAME_LOCK)
        return self._start("nexus", title or f"Nexus mod {mod_id}", game, profile, work)

    @unlocked
    def nexus_manual_install(self, game: str, profile: str, mod_id: int, file_id: int,
                             title: str = ""):
        """Free accounts. Returns {task, url}: open url (the file's Nexus download
        page) in Steam's browser; the task installs the file once it's in
        Downloads. url is "" when it's already downloaded (installs straight away).
        Unlocked: it waits on a Nexus lookup, so only the profile lookup takes
        GAME_LOCK."""
        with GAME_LOCK:
            g, pdir = self.ctx.target(game, profile)
        url_box: dict = {}
        url_ready = threading.Event()

        def on_url(url):
            url_box["url"] = url
            url_ready.set()

        def work(task):
            return self.nexus.manual_install(task, g, pdir, mod_id, file_id, GAME_LOCK, on_url)

        task = Task(self.taskmgr, "nexus", title or f"Nexus mod {mod_id}", game, profile)
        self.taskmgr.start(task, work)
        while not url_ready.wait(0.2) and task.state not in TERMINAL:
            pass
        if task.state == "error":
            raise BridgeError(task.error)
        return {"task": task.public(), "url": url_box.get("url", "")}

    # ---------------------------------------------------------------- Thunderstore

    @unlocked
    def ts_mods(self, game: str, query: str = "", ordering: str = "most-downloaded", page: int = 0):
        return self.thunderstore.mods(self.ctx.game(game), query, ordering, page)

    def ts_install(self, game: str, profile: str, namespace: str, name: str):
        g, pdir = self.ctx.target(game, profile)

        def work(task):
            return self.thunderstore.download_install(task, g, pdir, namespace, name, GAME_LOCK)
        return self._start("thunderstore", name.replace("_", " "), game, profile, work)
