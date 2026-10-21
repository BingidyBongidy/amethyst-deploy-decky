"""Shared plumbing for the bridge's RPC modules.

- The reply channel to the plugin (`send`, `emit`), opened once at startup.
- `GAME_LOCK` and the `@unlocked` marker: which RPCs may run alongside others.
- `BridgeError`: a failure shown to the user as-is.
- `Context`: the game catalogue and log every RPC module shares.
"""
from __future__ import annotations

import json
import os
import sys
import threading
from pathlib import Path

from amethyst_tasks import TaskError

_channel = None
_channel_lock = threading.Lock()


def open_channel() -> None:
    """Claim the real stdout for replies, then point fd 1 (and sys.stdout) at
    stderr so stray prints from Amethyst can't corrupt the protocol. Must run
    before Amethyst is imported."""
    global _channel
    _channel = os.fdopen(os.dup(1), "w", buffering=1, encoding="utf-8")
    os.dup2(2, 1)
    sys.stdout = sys.stderr


def send(message: dict) -> None:
    line = json.dumps(message, default=str) + "\n"
    with _channel_lock:
        _channel.write(line)
        _channel.flush()


def emit(event: str, data) -> None:
    """Unrequested message to the plugin: task progress, login result, log line."""
    send({"id": None, "event": event, "data": data})


# Background tasks write mod lists and staging folders; RPCs that touch game
# state hold this too, so the two never interleave.
GAME_LOCK = threading.RLock()


def unlocked(fn):
    """Mark an RPC that doesn't touch game state: it skips GAME_LOCK and runs
    alongside others, so a long install never stalls polling, browsing or cancel."""
    fn.unlocked = True
    return fn


class BridgeError(TaskError):
    """An expected failure, shown to the user as-is (no traceback)."""


class Context:
    """What every RPC module shares: Amethyst's game handlers and the log."""

    def __init__(self, discover_games):
        self._discover = discover_games
        self.games: dict = {}
        self._log: list[str] = []

    def log(self, msg) -> None:
        """Keep for recent_log and send to the Decky log (Amethyst captures our
        stderr, so it can't be relied on to get there)."""
        self._log.append(str(msg))
        del self._log[:-200]
        emit("log", str(msg))

    def recent_log(self) -> list[str]:
        return self._log[-50:]

    def rescan(self) -> dict:
        """Rediscover games. Deploy/restore run in a separate CLI process, so
        state on disk may have moved on since the last look."""
        self.games = self._discover()
        return self.games

    def all_games(self) -> dict:
        return self.games or self.rescan()

    def game(self, name: str):
        """A game handler by display name or game id (case-insensitive)."""
        games = self.all_games()
        g = games.get(name)
        if g is None:
            low = name.lower()
            g = next((x for n, x in games.items()
                      if n.lower() == low or getattr(x, "game_id", "").lower() == low), None)
        if g is None:
            raise BridgeError(f"Unknown game: {name}")
        return g

    def configured(self, name: str):
        g = self.game(name)
        if not g.is_configured():
            raise BridgeError(f"{g.name} isn't set up yet.")
        return g

    @staticmethod
    def profile_dir(g, profile: str) -> Path:
        """Make *profile* the game's active profile and return its folder."""
        pdir = g.get_profile_root() / "profiles" / profile
        if not pdir.is_dir():
            raise BridgeError(f"Profile '{profile}' doesn't exist.")
        g.set_active_profile_dir(pdir)
        g.load_paths()
        return pdir

    @staticmethod
    def profiles(g) -> list[str]:
        pdir = g.get_profile_root() / "profiles"
        if not pdir.is_dir():
            return []
        return sorted((p.name for p in pdir.iterdir() if p.is_dir()), key=str.lower)

    def target(self, game: str, profile: str):
        """(game handler, profile folder) for an install into a profile."""
        g = self.configured(game)
        return g, self.profile_dir(g, profile)
