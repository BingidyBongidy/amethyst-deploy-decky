"""Run the bridge against the fake home, the way the plugin does, for the smoke tests.

The bridge runs with Amethyst's source on PYTHONPATH and the same environment
quirks as inside Amethyst's Flatpak (XDG_* point into the sandbox).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

FAKE_HOME = Path("/tmp/bhome")
STAGING = FAKE_HOME / "Games" / "Amethyst" / "Profiles"
FLATPAK_ID = "io.github.Amethyst.ModManager"
BRIDGE = Path(__file__).resolve().parent.parent / "defaults" / "amethyst_bridge.py"
FINAL_STATES = ("done", "error", "cancelled")


class BridgeCallError(AssertionError):
    """The bridge answered with an error where the test expected a result."""


def _environment() -> dict:
    sandbox = FAKE_HOME / ".var" / "app" / FLATPAK_ID
    return dict(os.environ, HOME=str(FAKE_HOME), PYTHONPATH=os.environ["AMETHYST_SRC"],
                FLATPAK_ID=FLATPAK_ID,
                XDG_DATA_HOME=str(sandbox / "data"), XDG_CONFIG_HOME=str(sandbox / "config"))


class Bridge:
    """One bridge process. Use as a context manager."""

    def __init__(self, stderr_log: str):
        self._stderr = open(stderr_log, "w")  # noqa: SIM115 - closed in __exit__
        self.process = subprocess.Popen(
            [sys.executable, str(BRIDGE)], cwd=os.environ["AMETHYST_SRC"], env=_environment(),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self._stderr, text=True)
        self.events: list[dict] = []
        self._next_id = 0
        hello = json.loads(self.process.stdout.readline())
        assert hello["result"]["ready"], hello

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.process.stdin.close()
        exit_code = self.process.wait(timeout=60)
        self._stderr.close()
        assert exit_code == 0, f"bridge exited with {exit_code}"

    def request(self, method: str, **params) -> tuple:
        """(result, error) for one RPC; events that arrive meanwhile are kept."""
        self._next_id += 1
        message = {"id": self._next_id, "method": method, "params": params}
        self.process.stdin.write(json.dumps(message) + "\n")
        self.process.stdin.flush()
        while True:
            reply = json.loads(self.process.stdout.readline())
            if reply.get("event"):
                self.events.append(reply)
                continue
            assert reply["id"] == self._next_id, reply
            return reply.get("result"), reply.get("error")

    def call(self, method: str, **params):
        """The result; fails the test if the bridge answered with an error."""
        result, error = self.request(method, **params)
        if error:
            raise BridgeCallError(f"{method}: {error}")
        return result

    def error(self, method: str, **params) -> str:
        """The error message; fails the test if the call succeeded."""
        _, error = self.request(method, **params)
        assert error, f"{method} was expected to fail"
        return error

    def game(self, name: str) -> dict:
        return next(g for g in self.call("list_games") if g["name"] == name)

    def wait_for_task(self, task_id: str, *, until_finished: bool = False, timeout: float = 600):
        """Poll until the task stops working: finished, or waiting on a choice
        (unless *until_finished*)."""
        waiting = ("working", "choice") if until_finished else ("working",)
        deadline = time.time() + timeout
        while time.time() < deadline:
            task = next(t for t in self.call("tasks") if t["id"] == task_id)
            if task["state"] not in waiting:
                return task
            time.sleep(0.3)
        raise AssertionError(f"task {task_id} still {task['state']} after {timeout}s")


def run_checks(checks) -> None:
    """Run each check in order, printing a line per check."""
    for check in checks:
        check()
        print(f"ok   {check.__name__}")
