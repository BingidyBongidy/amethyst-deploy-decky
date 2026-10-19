# Amethyst Deploy (Decky plugin)

Decky Loader plugin that drives Amethyst Mod Manager (https://github.com/ChrisDKN/Amethyst-Mod-Manager)
from SteamOS Gaming Mode with a controller. Read PLAN.md first: it has the current
state, next steps and how to test.

## Layout
- `main.py`: Decky backend (runs as the deck user). Wraps Amethyst's CLI for
  deploy/restore, installs and updates the Flatpak, and manages the bridge process.
- `defaults/amethyst_bridge.py`: JSON-RPC helper that runs *inside* Amethyst's
  Flatpak Python and imports Amethyst's modules. `defaults/*` ship at the plugin root.
- `defaults/amethyst_snapshot.py`: one-shot game/profile listing for the QAM panel.
- `src/index.tsx`: frontend (React, `@decky/ui`, `@decky/api`).
- `tests/`: bridge smoke test against real Amethyst source plus a fake Steam home.

## Rules
- Never modify or vendor Amethyst. Call its CLI, or import its modules from the bridge.
- Mirror what Amethyst's GUI does (`src/gui_qt/*` in the Amethyst repo) rather than
  inventing behaviour. Cite the GUI function you copied in a comment.
- Host commands from the backend must use `_user_env()`, because Decky's
  `LD_LIBRARY_PATH` breaks `flatpak`.
- Stop the bridge before any CLI job that touches the same files (deploy, restore, update).
- The UI must work with a controller only: no mouse-style widgets, use `Focusable`
  and Steam-native components.
- Licence: GPL-3.0-or-later (the bridge imports Amethyst's GPL code).

## Debugging on the device
You can't reach the device. Ship a zip and ask Brad for these when something fails:
- Decky logs: `~/homebrew/logs/Amethyst Deploy/`
- Frontend console: enable CEF remote debugging in Decky's developer settings,
  then open `http://<device-ip>:8081` from a desktop browser.
- Before proposing a fix for an error, search for the exact error string. Don't
  guess at reboots or config changes.
