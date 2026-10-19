"""Amethyst Deploy - Decky backend.

Thin wrapper around Amethyst Mod Manager's CLI. Finds the install (Flatpak
preferred, AppImage fallback), lists games/profiles, and runs deploy/restore
in the background while streaming log lines to the frontend.
"""
import asyncio
import os
import pwd
import re
import shutil
from pathlib import Path

import decky

FLATPAK_ID = "io.github.Amethyst.ModManager"
MARKER = "AMETHYST_DECKY_JSON:"
APPIMAGE_NAMES = ("AmethystModManager-x86_64.AppImage",)


def _user_env() -> dict:
    """Environment for host commands run on behalf of the deck user.

    Decky is a PyInstaller bundle, so its LD_LIBRARY_PATH points at bundled
    libs that break host binaries like /usr/bin/flatpak. Strip it, and make
    sure the session bus / runtime dir are set so `flatpak run --user` and
    the keyring behave like they would from Desktop Mode.
    """
    env = {k: v for k, v in os.environ.items()
           if k not in ("LD_LIBRARY_PATH", "LD_PRELOAD", "LD_AUDIT",
                        "PYTHONHOME", "PYTHONPATH")}
    home = decky.DECKY_USER_HOME
    try:
        uid = pwd.getpwnam(decky.DECKY_USER).pw_uid
    except KeyError:
        uid = os.getuid()
    env["HOME"] = home
    env["USER"] = decky.DECKY_USER
    env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{uid}")
    env.setdefault("DBUS_SESSION_BUS_ADDRESS", f"unix:path=/run/user/{uid}/bus")
    env["PATH"] = "/usr/local/bin:/usr/bin:/bin:" + env.get("PATH", "")
    return env


async def _run(args, stdin_data: bytes | None = None, timeout: float = 120):
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.PIPE if stdin_data is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=_user_env(),
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(stdin_data), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise RuntimeError(f"timed out after {int(timeout)}s: {' '.join(args[:4])}")
    return proc.returncode, out.decode(errors="replace"), err.decode(errors="replace")


class Plugin:
    job: "asyncio.Task | None" = None
    job_log: list = []
    job_state: dict = {}

    # ---------- install detection ----------

    async def _flatpak_installed(self) -> bool:
        if not shutil.which("flatpak", path=_user_env()["PATH"]):
            return False
        try:
            rc, _, _ = await _run(["flatpak", "info", FLATPAK_ID], timeout=20)
            return rc == 0
        except Exception:
            return False

    def _find_appimage(self) -> "str | None":
        apps = Path(decky.DECKY_USER_HOME) / "Applications"
        for name in APPIMAGE_NAMES:
            p = apps / name
            if p.is_file() and os.access(p, os.X_OK):
                return str(p)
        if apps.is_dir():
            for p in sorted(apps.glob("Amethyst*.AppImage")):
                if os.access(p, os.X_OK):
                    return str(p)
        return None

    async def _install(self) -> dict:
        if await self._flatpak_installed():
            return {"kind": "flatpak",
                    "cli": ["flatpak", "run", f"--command=amethyst-mod-manager-cli", FLATPAK_ID]}
        appimage = self._find_appimage()
        if appimage:
            return {"kind": "appimage", "cli": [appimage]}
        return {"kind": "none", "cli": []}

    # ---------- frontend API ----------

    async def get_install(self) -> dict:
        inst = await self._install()
        return {"kind": inst["kind"]}

    async def list_games(self) -> dict:
        """Return {ok, kind, games:[...], error}."""
        inst = await self._install()
        if inst["kind"] == "none":
            return {"ok": False, "kind": "none", "games": [],
                    "error": "Amethyst isn't installed (no Flatpak or AppImage in ~/Applications)."}
        try:
            if inst["kind"] == "flatpak":
                games = await self._snapshot_flatpak()
            else:
                games = await self._snapshot_cli(inst["cli"])
        except Exception as e:
            decky.logger.exception("list_games failed")
            return {"ok": False, "kind": inst["kind"], "games": [], "error": str(e)}
        # Only configured games are useful here; unconfigured ones need the GUI.
        games = [g for g in games if g.get("configured")]
        return {"ok": True, "kind": inst["kind"], "games": games, "error": ""}

    async def _snapshot_flatpak(self) -> list:
        script = Path(decky.DECKY_PLUGIN_DIR) / "amethyst_snapshot.py"
        rc, out, err = await _run(
            ["flatpak", "run", "--command=python3", FLATPAK_ID, "-"],
            stdin_data=script.read_bytes(), timeout=180)
        for line in out.splitlines():
            if line.startswith(MARKER):
                import json
                return json.loads(line[len(MARKER):])
        decky.logger.warning("snapshot rc=%s stderr=%s", rc, err[-2000:])
        # Snapshot helper broke (upstream refactor?) - fall back to plain CLI.
        return await self._snapshot_cli(
            ["flatpak", "run", "--command=amethyst-mod-manager-cli", FLATPAK_ID])

    async def _snapshot_cli(self, cli: list) -> list:
        rc, out, err = await _run([*cli, "list-games"], timeout=180)
        if rc != 0:
            raise RuntimeError((err or out).strip().splitlines()[-1] if (err or out).strip() else f"list-games exit {rc}")
        games = parse_list_games(out)
        for g in games:
            if not g["configured"]:
                continue
            key = g["game_id"] or g["name"]
            prc, pout, _ = await _run([*cli, "list-profiles", key], timeout=120)
            if prc == 0:
                g["profiles"] = [l.strip() for l in pout.splitlines()
                                 if l.strip() and not l.startswith(("No profiles", "["))]
        return games

    async def start_job(self, action: str, game: str, profile: str = "") -> dict:
        """action: 'deploy' | 'restore'. Runs in background; poll job_status."""
        if self.job and not self.job.done():
            return {"ok": False, "error": "Something is already running."}
        if action not in ("deploy", "restore"):
            return {"ok": False, "error": f"unknown action {action}"}
        inst = await self._install()
        if inst["kind"] == "none":
            return {"ok": False, "error": "Amethyst isn't installed."}
        args = [*inst["cli"], action, game] + ([profile] if action == "deploy" else [])
        self.job_log = []
        self.job_state = {"action": action, "game": game, "profile": profile,
                          "running": True, "ok": None}
        self.job = asyncio.get_event_loop().create_task(self._run_job(args))
        return {"ok": True}

    async def _run_job(self, args: list):
        decky.logger.info("job: %s", " ".join(args))
        try:
            proc = await asyncio.create_subprocess_exec(
                *args, stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                env=_user_env())
            assert proc.stdout is not None
            async for raw in proc.stdout:
                line = raw.decode(errors="replace").rstrip()
                if not line:
                    continue
                self.job_log.append(line)
                self.job_log = self.job_log[-200:]
                await decky.emit("amethyst_log", line)
            rc = await proc.wait()
            self.job_state.update(running=False, ok=(rc == 0), rc=rc)
        except Exception as e:
            decky.logger.exception("job failed")
            self.job_log.append(f"Error: {e}")
            self.job_state.update(running=False, ok=False, rc=-1)
        await decky.emit("amethyst_done", self.job_state)

    async def job_status(self) -> dict:
        return {**self.job_state, "log": self.job_log[-20:]}

    # ---------- lifecycle ----------

    async def _main(self):
        decky.logger.info("Amethyst Deploy loaded")

    async def _unload(self):
        if self.job and not self.job.done():
            # Don't kill a deploy halfway through - let it finish on its own.
            decky.logger.info("unloading with a job still running")


_ROW = re.compile(r"^(?P<name>.+?)\s+(?P<gid>\S+)\s+(?P<cfg>yes|no)\s*$")


def parse_list_games(text: str) -> list:
    """Parse `list-games` table output.

    Columns are fixed-width but long names overflow, so parse from the right:
    last token is yes/no, the one before is game_id (no spaces), rest is name.
    """
    games = []
    for line in text.splitlines():
        if not line.strip() or line.startswith(("Game Name", "---", "[")):
            continue
        m = _ROW.match(line.rstrip())
        if not m:
            continue
        games.append({"name": m["name"].strip(), "game_id": m["gid"], "steam_id": "",
                      "configured": m["cfg"] == "yes", "profiles": [],
                      "deployed_profile": "", "deploy_active": False})
    return games
