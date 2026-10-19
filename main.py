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
REMOTE_NAME = "modmanager-origin"
REMOTE_URL = "https://chrisdkn.github.io/Amethyst-Mod-Manager/amethyst.flatpakrepo"
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


import json  # noqa: E402

# Methods the frontend may call on the bridge, with a timeout for each.
# LOOT downloads its masterlist and reads every plugin, so it gets longest.
# Installs and downloads run as bridge tasks and answer at once.
BRIDGE_METHODS = {
    "list_games": 120, "detect_installed": 120, "configure_game": 120,
    "create_profile": 30, "mods": 120, "set_mod_enabled": 120, "move_mod": 60,
    "plugins": 180, "set_plugin_enabled": 180, "move_plugin": 180,
    "loot_sort": 600, "recent_log": 10,
    "tasks": 10, "task_answer": 10, "task_cancel": 10,
    "fomod_view": 30, "fomod_toggle": 30, "fomod_image": 30,
    "local_archives": 30, "install_archive": 120,
    "nexus_status": 60, "nexus_login_start": 20, "nexus_login_stop": 10,
    "nexus_set_key": 60, "nexus_logout": 20, "nexus_mods": 60, "nexus_mod": 60,
    "nexus_install": 120, "ts_mods": 60, "ts_install": 120,
}


class BridgeClient:
    """One long-lived amethyst_bridge.py inside Amethyst's Flatpak.

    Starting Amethyst's Python and discovering ~100 games takes a few
    seconds, so we keep the process and talk JSON lines to it. A reader
    task matches responses to requests by id and forwards unsolicited
    events (task progress, Nexus login) to the frontend. If the helper
    dies it's restarted on the next call.
    """

    def __init__(self):
        self.proc: "asyncio.subprocess.Process | None" = None
        self.start_lock = asyncio.Lock()
        self.write_lock = asyncio.Lock()
        self.next_id = 0
        self.pending: dict = {}

    async def _start(self):
        script = Path(decky.DECKY_PLUGIN_DIR) / "amethyst_bridge.py"
        self.proc = await asyncio.create_subprocess_exec(
            "flatpak", "run", "--command=python3", FLATPAK_ID, str(script),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE, env=_user_env(),
            limit=16 * 1024 * 1024)  # big mod lists make long JSON lines
        loop = asyncio.get_event_loop()
        loop.create_task(self._drain_stderr(self.proc))
        hello = await asyncio.wait_for(self.proc.stdout.readline(), 120)
        if not hello:
            await self.stop()
            raise RuntimeError("Amethyst's helper exited on startup - check the Decky log.")
        decky.logger.info("bridge ready: %s", hello.decode().strip())
        loop.create_task(self._read(self.proc))

    @staticmethod
    async def _drain_stderr(proc):
        # Amethyst logs a lot; keep the pipe empty and the useful bits in our log.
        async for raw in proc.stderr:
            line = raw.decode(errors="replace").rstrip()
            if line and not line.startswith("[startup]"):
                decky.logger.debug("bridge: %s", line)

    async def _read(self, proc):
        try:
            async for raw in proc.stdout:
                try:
                    msg = json.loads(raw)
                except ValueError:
                    decky.logger.warning("bridge sent junk: %r", raw[:200])
                    continue
                if msg.get("event"):
                    await decky.emit("amethyst_event", msg["event"], msg.get("data"))
                    continue
                fut = self.pending.pop(msg.get("id"), None)
                if fut is not None and not fut.done():
                    fut.set_result(msg)
        finally:
            for fut in self.pending.values():
                if not fut.done():
                    fut.set_exception(RuntimeError("Amethyst's helper stopped unexpectedly."))
            self.pending.clear()
            if self.proc is proc:   # died on its own, not stop()
                await decky.emit("amethyst_event", "bridge_stopped", {})

    async def busy(self) -> bool:
        """True while the helper has an install or download in progress."""
        if self.proc is None or self.proc.returncode is not None:
            return False
        try:
            resp = await self.call("tasks", {}, 10)
        except Exception:
            return False
        return any(t.get("state") in ("working", "choice") for t in resp.get("result") or [])

    async def stop(self):
        proc, self.proc = self.proc, None
        if proc and proc.returncode is None:
            try:
                proc.stdin.close()
                await asyncio.wait_for(proc.wait(), 5)
            except Exception:
                proc.kill()
                await proc.wait()

    async def call(self, method: str, params: dict, timeout: float):
        async with self.start_lock:
            if self.proc is None or self.proc.returncode is not None:
                await self._start()
            proc = self.proc
        self.next_id += 1
        rid = self.next_id
        fut = asyncio.get_event_loop().create_future()
        self.pending[rid] = fut
        async with self.write_lock:
            proc.stdin.write((json.dumps({"id": rid, "method": method,
                                          "params": params}) + "\n").encode())
            await proc.stdin.drain()
        try:
            return await asyncio.wait_for(fut, timeout)
        finally:
            # A late answer is simply dropped; ids keep the stream in sync.
            self.pending.pop(rid, None)


class Plugin:
    job: "asyncio.Task | None" = None
    job_log: list = []
    job_state: dict = {}
    bridge: "BridgeClient | None" = None

    # ---------- full controller UI (bridge) ----------

    async def call(self, method: str, params: dict | None = None) -> dict:
        """Frontend entry point: {ok, result} or {ok: False, error}."""
        if method not in BRIDGE_METHODS:
            return {"ok": False, "error": f"Unknown action {method}"}
        if self.job and not self.job.done():
            return {"ok": False, "error": "Wait for the current deploy/install to finish."}
        if not await self._flatpak_installed():
            return {"ok": False, "error": "The full UI needs Amethyst's Flatpak. Install it from the plugin menu."}
        if self.bridge is None:
            self.bridge = BridgeClient()
        try:
            resp = await self.bridge.call(method, params or {}, BRIDGE_METHODS[method])
        except asyncio.TimeoutError:
            return {"ok": False, "error": "Amethyst took too long to answer. Try again."}
        except Exception as e:
            decky.logger.exception("bridge call %s failed", method)
            return {"ok": False, "error": str(e)}
        if "error" in resp:
            return {"ok": False, "error": resp["error"]}
        return {"ok": True, "result": resp.get("result")}

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

    async def start_job(self, action: str, game: str = "", profile: str = "") -> dict:
        """action: deploy | restore | install | update. Runs in background."""
        if self.job and not self.job.done():
            return {"ok": False, "error": "Something is already running."}
        if action in ("install", "update"):
            cmds = self._flatpak_commands(action)
        elif action in ("deploy", "restore"):
            inst = await self._install()
            if inst["kind"] == "none":
                return {"ok": False, "error": "Amethyst isn't installed."}
            cmds = [[*inst["cli"], action, game] + ([profile] if action == "deploy" else [])]
        else:
            return {"ok": False, "error": f"unknown action {action}"}
        if self.bridge is not None:
            if await self.bridge.busy():
                return {"ok": False, "error": "Wait for mod installs to finish first."}
            # Deploy/restore/update run as separate processes on the same files;
            # don't leave the helper holding them open. It restarts on demand.
            await self.bridge.stop()
        self.job_log = []
        self.job_state = {"action": action, "game": game, "profile": profile,
                          "running": True, "ok": None}
        self.job = asyncio.get_event_loop().create_task(self._run_job(cmds))
        return {"ok": True}

    def _flatpak_commands(self, action: str) -> list:
        """Official install route from Amethyst's README: its own Flatpak remote, user scope.

        The 32-bit compat extensions aren't installed here - Amethyst adds
        them itself on first launch, and they come from Flathub, which on
        SteamOS is a system remote, not a user one.
        """
        flags = ["--user", "-y", "--noninteractive"]
        if action == "update":
            return [["flatpak", "update", *flags, FLATPAK_ID]]
        return [
            ["flatpak", "remote-add", "--user", "--if-not-exists", REMOTE_NAME, REMOTE_URL],
            ["flatpak", "install", *flags, REMOTE_NAME, f"{FLATPAK_ID}//stable"],
        ]

    async def _run_job(self, cmds: list):
        rc = 0
        try:
            for args in cmds:
                decky.logger.info("job: %s", " ".join(args))
                await self._log(f"$ {' '.join(args[:4])}{' …' if len(args) > 4 else ''}")
                proc = await asyncio.create_subprocess_exec(
                    *args, stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                    env=_user_env())
                assert proc.stdout is not None
                buf = b""
                # flatpak redraws progress with \r, so split on both
                while chunk := await proc.stdout.read(4096):
                    buf += chunk
                    *lines, buf = re.split(rb"[\r\n]", buf)
                    for raw in lines:
                        line = raw.decode(errors="replace").rstrip()
                        if line:
                            await self._log(line)
                if buf.strip():
                    await self._log(buf.decode(errors="replace").rstrip())
                rc = await proc.wait()
                if rc != 0:
                    break
            self.job_state.update(running=False, ok=(rc == 0), rc=rc)
        except Exception as e:
            decky.logger.exception("job failed")
            self.job_log.append(f"Error: {e}")
            self.job_state.update(running=False, ok=False, rc=-1)
        await decky.emit("amethyst_done", self.job_state)

    async def _log(self, line: str):
        # progress bars spam near-identical lines; replace rather than append
        strip = lambda s: re.sub(r"[\d.%\s/]+", "", s)[:30]
        if self.job_log and "%" in line and strip(line) == strip(self.job_log[-1]):
            self.job_log[-1] = line
        else:
            self.job_log.append(line)
            self.job_log = self.job_log[-200:]
        await decky.emit("amethyst_log", line)

    async def job_status(self) -> dict:
        return {**self.job_state, "log": self.job_log[-20:]}

    # ---------- lifecycle ----------

    async def _main(self):
        decky.logger.info("Amethyst Deploy loaded")

    async def _unload(self):
        if self.job and not self.job.done():
            # Don't kill a deploy halfway through - let it finish on its own.
            decky.logger.info("unloading with a job still running")
        if self.bridge is not None:
            await self.bridge.stop()


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
