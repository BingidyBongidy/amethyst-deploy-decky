"""Runs INSIDE the Amethyst Flatpak (piped to its python3 on stdin).

Prints one JSON line, prefixed with a marker, describing every discovered game:
name, game_id, Steam app ID, configured state, profiles and deploy state.
One process instead of N list-profiles calls, and it gives us Steam IDs,
which the plain CLI output doesn't expose.
"""
import json
import sys

MARKER = "AMETHYST_DECKY_JSON:"

sys.argv = ["amethyst", "list-games"]
import cli  # noqa: E402  (installed alongside Amethyst in the Flatpak)

cli._setup_path()

from Utils.games.discovery import discover_games  # noqa: E402

out = []
for name, game in sorted(discover_games().items()):
    entry = {"name": name, "game_id": getattr(game, "game_id", "") or "",
             "steam_id": "", "configured": False, "profiles": [],
             "deployed_profile": "", "deploy_active": False}
    try:
        entry["configured"] = bool(game.is_configured())
    except Exception:
        pass
    try:
        entry["steam_id"] = str(game.effective_steam_id() or game.steam_id or "")
    except Exception:
        try:
            entry["steam_id"] = str(game.steam_id or "")
        except Exception:
            pass
    if entry["configured"]:
        try:
            pdir = game.get_profile_root() / "profiles"
            if pdir.is_dir():
                entry["profiles"] = sorted(p.name for p in pdir.iterdir() if p.is_dir())
        except Exception:
            pass
        try:
            entry["deploy_active"] = bool(game.get_deploy_active())
            entry["deployed_profile"] = game.get_last_deployed_profile() or ""
        except Exception:
            pass
    out.append(entry)

print(MARKER + json.dumps(out), flush=True)
