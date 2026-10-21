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
- `defaults/amethyst_*.py`: the bridge's other modules (tasks, Nexus/Thunderstore,
  Unifideck, game-folder resolver). See `docs/ARCHITECTURE.md` for the full map.
- `src/`: frontend (React, `@decky/ui`, `@decky/api`). `index.tsx` is the QAM panel and
  route; `AmethystPage.tsx` the full-screen page; `shared.tsx` the RPC types and hooks.
- `tests/`: bridge smoke tests against real Amethyst source plus a fake Steam home;
  `src/**/*.test.tsx` are the frontend tests.

## Rules
- Never modify or vendor Amethyst. Call its CLI, or import its modules from the bridge.
- Mirror what Amethyst's GUI does (`src/gui_qt/*` in the Amethyst repo) rather than
  inventing behaviour. Cite the GUI function you copied in a comment.
- Host commands from the backend must use `_user_env()`, because Decky's
  `LD_LIBRARY_PATH` breaks `flatpak`.
- Stop the bridge before any CLI job that touches the same files (deploy, restore, update).
- Zero mouse: every flow must work with gamepad buttons and the D-pad alone, using
  `Focusable` and Steam-native components. No mouse-style widgets, and no step that
  needs a trackpad or stick-as-cursor (that includes clicking on a web page in
  Steam's browser). If a flow can't meet this, raise it with Brad; don't ship it.
  Agreed exceptions (2026-10-19), both on Nexus pages in Steam's browser with the
  trackpad: logging in to Nexus (sign in once, press Authorize), and free accounts
  pressing "Slow download", one click per file.
- Game-agnostic: no code, text or tests that single out a particular game. Behaviour
  comes from what Amethyst's handler declares (exe names, base plugins, Nexus domain,
  Thunderstore community, Steam id), so every game gets the same treatment. If a game
  needs something different, it belongs in Amethyst's handler for it, not here.
- Licence: GPL-3.0-or-later (the bridge imports Amethyst's GPL code).

## Readable code
Code here gets reviewed by people, so optimise for reading, not writing.
- One responsibility per module and class. If you can't give it a short, accurate
  name, split it.
- Files aim for under 400 lines; anything over 500 needs splitting or a stated reason.
  Functions fit on a screen (about 50 lines) and do one thing. No flag arguments that
  switch a function between two behaviours: make two functions.
- One statement per line. Prefer a named helper or an early return over a nested
  ternary, a long chained expression or a multi-line lambda.
- Names say what something is; comments say why (the GUI function mirrored, the
  device quirk, the trade-off). Don't comment what the code already says.
- Frontend: styles live in `src/ui.tsx` classes, not long inline `style={{...}}`
  objects; components over ~150 lines get split.
- Checks: `ruff check` (Python) and `pnpm lint` (TypeScript) enforce the size and
  complexity limits. Run them with the tests; fix what they flag rather than
  disabling the rule.
- Every review, including your own before you finish, also looks at the size and
  responsibilities of the files touched, not just the diff.

## Debugging on the device
You can't reach the device. Ship a zip and ask Brad for these when something fails:
- Decky logs: `~/homebrew/logs/Amethyst Deploy/`
- Frontend console: enable CEF remote debugging in Decky's developer settings,
  then open `http://<device-ip>:8081` from a desktop browser.
- Before proposing a fix for an error, search for the exact error string. Don't
  guess at reboots or config changes.
