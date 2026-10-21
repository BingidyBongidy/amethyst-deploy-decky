"""Amethyst bridge: runs INSIDE Amethyst's Flatpak Python, started by the plugin.

Line-delimited JSON-RPC over stdin/stdout:
    request : {"id": 1, "method": "mods", "params": {...}}
    response: {"id": 1, "result": ...}  or  {"id": 1, "error": "message"}
    event   : {"id": null, "event": "task", "data": {...}}   (unrequested)

The RPCs live in one module per area, each calling Amethyst's own modules so
the controller UI behaves like Amethyst's GUI:
    amethyst_setup      games, Setup tab, folder picker, profiles
    amethyst_modlist    Mods tab
    amethyst_loadorder  Load order tab, LOOT
    amethyst_installs   tasks and prompts, Downloads, Nexus, Thunderstore
This file only starts up, builds the method table and dispatches requests.
Anything Amethyst prints goes to stderr; stdout carries only replies.
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# Our modules sit next to this script (the plugin root).
sys.path.insert(0, str(Path(__file__).resolve().parent))
import amethyst_rpc as rpc

# Must happen before Amethyst is imported: it prints to stdout.
rpc.open_channel()

sys.argv = ["amethyst", "list-games"]
import cli  # installed alongside Amethyst in the Flatpak

cli._setup_path()

from Utils.games.discovery import discover_games
from amethyst_installs import InstallsRpc
from amethyst_loadorder import LoadOrderRpc
from amethyst_modlist import ModlistRpc
from amethyst_setup import SetupRpc
from amethyst_tasks import TaskError

PROTOCOL = 2


def build_methods(ctx: rpc.Context) -> dict:
    """{method name: bound method} for every public method of every RPC
    class: a method is callable by the plugin exactly when its name has no
    leading underscore (main.py's BRIDGE_METHODS then decides which the
    frontend may use). A name defined twice is a bug, so it fails at startup."""
    methods: dict = {
        "ping": rpc.unlocked(lambda: {"protocol": PROTOCOL}),
        "recent_log": rpc.unlocked(lambda: ctx.recent_log()),
    }
    for group in (SetupRpc(ctx), ModlistRpc(ctx), LoadOrderRpc(ctx), InstallsRpc(ctx)):
        for name in dir(group):
            member = getattr(group, name)
            if name.startswith("_") or not callable(member) or name == "ctx":
                continue
            if name in methods:
                raise RuntimeError(f"RPC {name} is defined twice")
            methods[name] = member
    return methods


def dispatch(fn, request_id, params: dict) -> None:
    """Run one RPC and send its reply. @unlocked ones skip GAME_LOCK."""
    try:
        if getattr(fn, "unlocked", False):
            result = fn(**params)
        else:
            with rpc.GAME_LOCK:
                result = fn(**params)
        reply = {"id": request_id, "result": result}
    except TaskError as e:
        reply = {"id": request_id, "error": str(e)}
    except Exception as e:
        traceback.print_exc()
        reply = {"id": request_id, "error": f"{type(e).__name__}: {e}"}
    rpc.send(reply)


def main() -> None:
    methods = build_methods(rpc.Context(discover_games))
    # Game-state RPCs run one at a time, in order; @unlocked ones run alongside
    # them. Replies carry their request id, so the plugin matches them up.
    locked = ThreadPoolExecutor(1, thread_name_prefix="rpc-locked")
    free = ThreadPoolExecutor(4, thread_name_prefix="rpc")
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
        except ValueError:
            continue
        request_id, name = request.get("id"), request.get("method", "")
        fn = methods.get(name)
        if fn is None:
            rpc.send({"id": request_id, "error": f"Unknown method {name}"})
            continue
        pool = free if getattr(fn, "unlocked", False) else locked
        pool.submit(dispatch, fn, request_id, request.get("params") or {})
    locked.shutdown()
    free.shutdown()


if __name__ == "__main__":
    rpc.send({"id": None, "result": {"ready": True, "protocol": PROTOCOL}})
    try:
        main()
    except BaseException:
        # Amethyst captures stderr, so a fatal error could otherwise vanish.
        if os.environ.get("AMETHYST_BRIDGE_DEBUG"):
            with open(os.environ["AMETHYST_BRIDGE_DEBUG"], "a") as f:
                traceback.print_exc(file=f)
        raise
