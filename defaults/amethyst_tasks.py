"""Background tasks for the bridge: install an archive, download from Nexus or
Thunderstore and install. Each task runs on its own thread and reports through
bridge events, so the controller UI stays usable while it works.

When a task needs the user (FOMOD options, BAIN packages, a mod that already
exists, Thunderstore dependencies) it parks in state "choice" and waits for
task_answer. Every flow mirrors what Amethyst's GUI does; the GUI function is
named next to each step.
"""
from __future__ import annotations

import base64
import html
import io
import re
import threading
import time
import traceback
import uuid
from pathlib import Path

TERMINAL = ("done", "error", "cancelled")


class TaskError(Exception):
    """A user-facing failure (shown as-is)."""


class Cancelled(Exception):
    pass


class Task:
    def __init__(self, mgr, kind: str, title: str, game: str, profile: str):
        self.mgr = mgr
        self.id = uuid.uuid4().hex[:10]
        self.kind, self.title, self.game, self.profile = kind, title, game, profile
        self.state = "working"
        self.step = "Starting…"
        self.progress: "list[int] | None" = None
        self.choice: "dict | None" = None
        self.result: "dict | None" = None
        self.error = ""
        self.cancel = threading.Event()
        self.fomod = None          # (FomodSession, base Path) while a FOMOD choice is open
        self.log_lines: list[str] = []
        self._answer = None
        self._answered = threading.Event()
        self._last_emit = 0.0
        self.created = time.time()

    def public(self) -> dict:
        return {"id": self.id, "kind": self.kind, "title": self.title,
                "game": self.game, "profile": self.profile, "state": self.state,
                "step": self.step, "progress": self.progress, "choice": self.choice,
                "result": self.result, "error": self.error}

    def emit(self, force=True):
        now = time.monotonic()
        if not force and now - self._last_emit < 0.25:
            return
        self._last_emit = now
        self.mgr.emit("task", self.public())

    def log(self, msg):
        """Kept with the task; only a failure's last lines reach the Decky log
        (installs log hundreds of lines)."""
        self.log_lines.append(str(msg))
        del self.log_lines[:-200]

    def set_step(self, step: str, progress=None):
        self.check()
        self.step, self.progress = step, progress
        self.emit()

    def set_progress(self, done, total, step=None):
        if self.cancel.is_set():
            return
        self.progress = [int(done or 0), int(total or 0)]
        if step:
            self.step = step
        self.emit(force=False)

    def check(self):
        if self.cancel.is_set():
            raise Cancelled()

    def ask(self, choice: dict):
        """Park until the UI answers. Returns the answer; raises Cancelled."""
        self._answered.clear()
        self._answer = None
        self.state, self.choice, self.progress = "choice", choice, None
        self.emit()
        while not self._answered.wait(0.5):
            self.check()
        self.check()
        self.state, self.choice = "working", None
        self.emit()
        return self._answer

    def request_cancel(self):
        self.cancel.set()
        self._answered.set()   # wake the task if it's parked on a choice

    def answer(self, value):
        if self.state != "choice":
            raise TaskError("This task isn't waiting for an answer.")
        self._answer = value
        self._answered.set()


class TaskManager:
    def __init__(self, emit, log):
        self.emit = emit
        self.log = log
        self.tasks: dict[str, Task] = {}

    def start(self, task: Task, fn) -> dict:
        self.tasks[task.id] = task
        # Keep finished tasks around briefly so the UI can show the outcome.
        done = [t for t in self.tasks.values() if t.state in TERMINAL]
        for t in sorted(done, key=lambda t: t.created)[:-20]:
            self.tasks.pop(t.id, None)

        def run():
            try:
                task.result = fn(task) or {}
                task.state, task.step, task.progress = "done", "Done", None
            except Cancelled:
                task.state, task.step = "cancelled", "Cancelled"
            except TaskError as e:
                task.state, task.error = "error", str(e)
            except Exception as e:
                traceback.print_exc()
                task.state, task.error = "error", f"{type(e).__name__}: {e}"
            if task.state == "error":
                lines = [f"task '{task.title}' failed: {task.error}", *task.log_lines[-15:]]
                self.log("\n  ".join(lines))
            task.choice = None
            task.fomod = None
            task.emit()

        task.emit()
        threading.Thread(target=run, daemon=True, name=f"task-{task.id}").start()
        return task.public()

    def get(self, task_id: str) -> Task:
        t = self.tasks.get(task_id)
        if t is None:
            raise TaskError("That task has finished or doesn't exist.")
        return t



# ---------------------------------------------------------------- install


def _unique_name(staging: Path, name: str) -> str:
    n = 2
    while (staging / f"{name} ({n})").exists():
        n += 1
    return f"{name} ({n})"


def install_archive_flow(task: Task, g, profile_dir: Path, archive: Path, *,
                         game_lock, meta=None, interactive=True) -> str:
    """Install one archive into a profile. Mirror of the GUI's queue
    (gui_qt/app.py _install_next -> _on_prepared_ready -> _run_finish_install):
    prepare_archive, then the FOMOD wizard / BAIN picker when the archive has
    one, then finish_install. Returns the installed mod folder name."""
    from Utils.mods.install import prepare_archive, finish_install
    from Utils.mods.copy import resolve_target_staging

    task.set_step(f"Unpacking {archive.name}")
    prepared = prepare_archive(
        str(archive), g, profile_dir, log_fn=task.log,
        progress_fn=lambda d, t, ph=None: task.set_progress(d, t, f"Unpacking {archive.name}"),
        prebuilt_meta=meta, cancel=task.cancel)
    task.check()
    if prepared is None:
        last = next((line for line in reversed(task.log_lines) if line.strip()), "")
        raise TaskError(f"Couldn't unpack {archive.name}. {last}".strip())
    finishing = False
    try:
        fomod_sel = bain_sel = None
        if prepared.is_fomod() and prepared.fomod_has_steps() and interactive:
            # gui_qt/fomod_wizard_view.py, driven by the Qt-free FomodSession.
            from Utils.fomod.session import FomodSession
            session = FomodSession(prepared.fomod_config,
                                   saved=prepared.saved_fomod_selections or {},
                                   context=prepared.fomod_context)
            task.fomod = (session, Path(prepared.fomod_base))
            task.ask({"kind": "fomod",
                      "title": prepared.fomod_config.name or prepared.mod_name})
            if session.errors:
                raise TaskError(session.errors[0][1])
            fomod_sel = session.selections
            task.fomod = None
        elif prepared.is_bain() and interactive:
            # gui_qt/bain_picker_view.py: pick sub-packages, "00" ones preselected.
            picked = task.ask({
                "kind": "bain", "mod": prepared.mod_name,
                "readme": (prepared.readme_text or "")[:3000],
                "packages": [{"name": p.name, "label": p.display_name or p.name,
                              "default": bool(p.default_selected)}
                             for p in prepared.bain_subpkgs]})
            bain_sel = {"selected": [str(n) for n in (picked or [])]}

        staging = Path(resolve_target_staging(g, Path(profile_dir)))
        decision = "replace"
        if (staging / prepared.mod_name).exists() and interactive:
            # gui_qt/app.py _make_exists_cb: Replace / install as new / cancel.
            decision = task.ask({"kind": "exists", "mod": prepared.mod_name})
            if decision not in ("replace", "rename"):
                raise Cancelled()

        def on_exists(name, conflict, _prepared):
            if decision == "rename" or conflict:
                return "rename:" + _unique_name(staging, name)
            return "replace"

        task.set_step(f"Installing {prepared.mod_name}")
        finishing = True
        with game_lock:
            # interactive=False: game post-install hooks must not try to show dialogs.
            name = finish_install(prepared, fomod_sel, log_fn=task.log,
                                  progress_fn=lambda d, t, ph=None: task.set_progress(
                                      d, t, f"Installing {prepared.mod_name}"),
                                  on_exists=on_exists, bain_selections=bain_sel,
                                  interactive=False)
        if not name:
            raise Cancelled()
        return name
    finally:
        if not finishing:
            prepared.cleanup()


# ---------------------------------------------------------------- FOMOD view


def strip_markup(text: str, limit=6000) -> str:
    """HTML/BBCode to plain text, for Nexus descriptions and FOMOD options."""
    text = re.sub(r"(?i)<br\s*/?>|\[/?(p|line)\]", "\n", text or "")
    text = re.sub(r"<[^>]+>|\[/?[a-z*]+(=[^\]]*)?\]", "", text, flags=re.I)
    text = html.unescape(text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()[:limit]


def fomod_view(task: Task) -> dict:
    if task.fomod is None:
        raise TaskError("No installer options are open for this task.")
    session, _ = task.fomod
    cfg = session.config
    steps = []
    for si in session.visible:
        step = cfg.steps[si]
        sel = session.selections.get(str(si), {})
        groups = []
        for gi, group in enumerate(step.groups):
            states = session.states.get((si, gi), {})
            chosen = sel.get(group.name, [])
            options = []
            for p in group.plugins:
                st = states.get(p.name)
                options.append({
                    "name": p.name, "description": strip_markup(p.description, 4000),
                    "image": bool(p.image_path), "selected": p.name in chosen,
                    "type": st.plugin_type if st else "Optional",
                    "locked": bool(st and st.locked),
                    "missing": bool(st and st.missing_dependency),
                    "previous": bool(st and st.previously_selected)})
            groups.append({"name": group.display_name or group.name,
                           "type": group.group_type, "options": options})
        steps.append({"index": si, "name": step.name, "groups": groups})
    return {"title": cfg.name or task.title, "steps": steps,
            "errors": [{"step": si, "message": msg} for si, msg in session.errors]}


def fomod_toggle(task: Task, step: int, group: int, name: str) -> dict:
    if task.fomod is None:
        raise TaskError("No installer options are open for this task.")
    task.fomod[0].toggle(int(step), int(group), name)
    return fomod_view(task)


def fomod_image(task: Task, step: int, group: int, name: str) -> str:
    """Option image as a small JPEG data URL (the GUI shows it full size)."""
    if task.fomod is None:
        return ""
    session, base = task.fomod
    grp = session.config.steps[int(step)].groups[int(group)]
    plugin = next((p for p in grp.plugins if p.name == name), None)
    if plugin is None or not plugin.image_path:
        return ""
    from Utils.fomod.parser import resolve_path_ci
    path = resolve_path_ci(str(base), plugin.image_path)
    if not path:
        return ""
    try:
        from PIL import Image
        with Image.open(path) as im:
            im = im.convert("RGB")
            im.thumbnail((720, 405))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=82)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return ""
