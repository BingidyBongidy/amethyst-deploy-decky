# Plan: native controller UI for Amethyst Mod Manager

Goal: manage mods for Amethyst Mod Manager entirely from SteamOS Gaming Mode
with a controller, in a UI that feels like the rest of Steam. No Desktop
Mode and no mouse-style UI.

## Where things stand

### Done and on `main` (v0.2.0)
- Quick Access menu panel: pick game and profile, **Deploy & Play**,
  **Deploy only**, **Restore vanilla**, live log, and a toast when finished.
- Wraps Amethyst's own CLI (`deploy`, `restore`, `list-games`,
  `list-profiles`). Flatpak preferred, AppImage fallback.
- **Install Amethyst** / **Update Amethyst** using the official Flatpak remote.
- Tested against Amethyst's real CLI built from source, with fake
  `flatpak`/AppImage wrappers. **Not yet run on a real device.**

### In progress on `phase-1`
- `defaults/amethyst_bridge.py`: a long-lived JSON-RPC helper run inside
  Amethyst's Flatpak Python. It imports Amethyst's own modules, so behaviour
  matches the GUI. It has these methods:
  - `list_games`, `detect_installed`: every launcher Amethyst knows (Steam,
    Heroic, Lutris, Faugus, Bottles, non-Steam shortcuts, standalone), via the
    same `InstalledIndex` the GUI's Add Game picker uses
  - `configure_game`: mirrors the GUI's Configure Game auto-detect: first
    install candidate, its Wine/Proton prefix, launcher ids, profile structure
  - `create_profile`
  - `mods`, `set_mod_enabled` (also syncs plugins.txt), `move_mod`
  - `plugins`, `set_plugin_enabled`, `move_plugin` (refuses moves that put a
    plugin above its masters, like the GUI)
  - `loot_sort`: mirrors the GUI's Sort Plugins
- `tests/bridge_smoke.py` + `tests/make_fake_home.sh` exercise all of that
  against real Amethyst source with a fake Steam library holding Skyrim SE
  and a fake Heroic GOG install of Fallout New Vegas.
  Everything passes, including `loot_sort` with libloot 0.29.6 built locally.
- `main.py` has a `BridgeClient` that starts the helper with
  `flatpak run --command=python3 io.github.Amethyst.ModManager <plugin dir>/amethyst_bridge.py`,
  sends serialised requests with per-method timeouts, restarts it if it dies,
  and stops it before deploy/restore/install jobs. The frontend calls it
  through `Plugin.call(method, params)` with an allowlist. **Untested.**

## Next steps

### 1. Verify on the device first (highest risk)
The build agent has no access to the handheld; Brad installs builds and reports
back (Decky log + what he saw). Before building more UI, produce a zip and ask
Brad to confirm:
- [ ] The Decky backend can run `flatpak` (the `LD_LIBRARY_PATH` stripping and
      the session bus env in `_user_env()`).
- [ ] **Install Amethyst** works from Gaming Mode.
- [ ] Deploy & Play launches the game (`SteamClient.Apps.RunGame`).
- [ ] The bridge starts inside the Flatpak from the plugin directory
      (`~/homebrew/plugins/Amethyst Deploy/`) and `import cli` works there.
- [ ] Steam's built-in browser: does "Download with Mod Manager" (`nxm://`)
      reach anything? Does "Manual download" save to `~/Downloads`? This
      decides the free-account install flow in phase 2.

### 2. Phase 1 UI (frontend, `src/`)
**Built, not yet run on a device.** `src/AmethystPage.tsx` (route + tabs),
`src/ReorderList.tsx` (A toggle / X pick up / D-pad carry / A drop / B cancel),
`src/shared.tsx` (types, bridge client, job hook, launch helpers). Mods are shown
in file order (top = highest priority), matching the GUI's default natural sort
(`gui_qt/modlist_sort.py`). Device checks for this:
- [ ] "Open Amethyst" in the QAM opens the full-screen page; B goes back.
- [ ] L1/R1 switch tabs; the list scrolls with the focused row.
- [ ] Carrying a row with the D-pad keeps focus on it (rows are keyed by
      position so Steam's own navigation moves focus; see `ReorderList`).
- [ ] B while carrying cancels and does *not* leave the page.
- [ ] The profile-name field brings up the on-screen keyboard.

Original spec:
- Full-screen route (`routerHook.addRoute("/amethyst", ...)`), opened from
  an "Open Amethyst" button in the QAM panel.
- Header: game and profile pickers, Deploy & Play.
- Tabs (`@decky/ui` `Tabs`):
  - **Mods**: rows built with `Focusable`. A toggles; X picks a row up, the
    D-pad moves it, and A drops it (`move_mod`). Separators render as headers.
  - **Plugins** (only when `has_plugins`): same controls as Mods, plus
    "Sort with LOOT". Show missing and late master warnings inline. Vanilla
    plugins are dimmed and fixed.
  - **Setup**: games detected but not set up, with a one-tap Configure,
    then create profile (on-screen keyboard).
- When `configure_game` returns `needs_first_launch`, tell the user to
  launch the game once so Steam creates the Proton prefix.
- Keep the UI usable while a deploy job runs; disable mutating actions.

### 3. Phase 2: browse, search and install mods (no Desktop Mode, ever)
**Built 2026-10-19, not yet run on a device.** Backend: `defaults/amethyst_tasks.py`
(background tasks, FOMOD/BAIN/exists/deps choices), `defaults/amethyst_sources.py`
(Nexus API-key login via phone QR, browse/search, Premium download; Thunderstore),
tested by `tests/install_smoke.py` (incl. a live Thunderstore install). Frontend:
`src/install/` (task tray, prompts, FOMOD wizard, Downloads tab) and `src/getmods/`
(Get mods tab). Device checks:
- [ ] Downloads tab lists `~/Downloads`; A installs; a FOMOD archive opens the
      wizard, D-pad + A pick options, Install works; B asks "Cancel install?".
- [ ] Get mods → Nexus: the QR opens the login page on a phone on the same Wi-Fi
      (if not, the Deck's firewall/network blocks it - check the Decky log for the
      URL); pasting the key logs in; browse/search/details work.
- [ ] Nexus Premium file install.
- [ ] Free account: pressing a file opens its Nexus page in Steam's browser;
      after logging in to the site once, Slow download saves into ~/Downloads
      (if Steam saves elsewhere, the watcher never sees it - check where) and
      the mod installs on its own.
- [ ] Thunderstore game (e.g. Valheim): search, Install latest, dependency prompt.
- [ ] Focus after "Load more", after Back from details, and after FOMOD Next.
- [ ] Unifideck game: Deploy & Play launches the Unifideck shortcut.

Decided 2026-10-19 with Brad: everything happens in the plugin, with **zero
mouse**: gamepad buttons and D-pad only, never a trackpad or stick-as-cursor
(see CLAUDE.md). The target user has a **free** Nexus account. Free accounts can't download through the API
alone: every file needs a click on the Nexus site, which then either hands
over an `nxm://` link (key + expiry, which the API accepts for free users) or
saves the archive through the browser. Amethyst works the same way
(`Nexus/manual_download_watch.py`, `Nexus/nexus_api.py:get_download_links`).

Build order (each step ships a zip for Brad to test):
1. **Install from Downloads**: list archives in `~/Downloads`, install one into
   the current profile with `Utils/mods/install.py` (`prepare_archive` ->
   `finish_install`). FOMOD installers become controller pages, one step per
   page (`Utils/fomod/session.py` gives option states). This is the install
   pipeline every later step uses.
2. **Nexus login**: `Nexus/nexus_oauth.py` (OAuth + PKCE, redirect to
   `localhost:7890`). The bridge runs the callback server; the frontend opens
   the authorise URL in Steam's browser. Tokens go in the keyring like the GUI.
3. **Browse and search**: `search_mods`, `get_trending_mods_graphql`,
   `get_mod`, `get_mod_files` for the current game. Cards with image, summary,
   endorsements, files list. Works for free accounts.
4. **Downloads**. Premium: one press, straight through the API, fully
   gamepad. Free: Nexus requires a click on its own site for every file, and
   Steam's browser only clicks with a cursor, which breaks the zero-mouse rule.
   **Open question for Brad** before building this step:
   - Recommend Premium for the zero-mouse experience, and keep free accounts
     to Install from Downloads and Thunderstore; or
   - check on the device whether Steam's browser lets the D-pad focus and press
     links on a page (if it does, the free flow can stay gamepad-only); or
   - have the plugin press the site's button on the user's behalf. Don't build
     this without checking Nexus's terms: it may count as automating free
     downloads, which Nexus forbids.
5. **Thunderstore games** (BepInEx titles: Valheim, Lethal Company, ...):
   `Thunderstore/*` has no account limits, so these can install in one press.

### 3a. More install sources
- **Unifideck** (Decky plugin for Epic/GOG/Amazon): **done in the bridge**
  (`defaults/amethyst_unifideck.py`, launcher name `unifideck`; tested with a
  fake Epic Fallout 3). `list_games` now also returns `shortcut_appid`: when
  set, Deploy & Play should launch that non-Steam shortcut, not `steam_id`
  (frontend still to do). Amethyst can't see these installs itself. How: install path from
  `~/.config/legendary/installed.json` matched on Amethyst's
  `heroic_app_names`, Steam shortcut id from
  `~/.local/share/unifideck/games.map` (`epic:<appName> = exe\twork_dir\tappid`),
  saved as Amethyst's `shortcut_appid` so the prefix resolves through the
  `compatdata/<appid>` link Unifideck makes on first launch.

### 4. Phase 3: collections
- `Utils/collections/*`. Collection downloads for free accounts have the same
  limitation as single mods.

## Risks
- **Amethyst internals aren't a stable API**, and upstream changes almost
  daily. Mitigation: run `tests/bridge_smoke.py` against the Amethyst
  version the user has installed, and record the tested version. Consider
  pinning the Flatpak (`flatpak update --commit=`) to a known-good build.
- `gui_qt/plugin_state.py` is a GUI module but Qt-free. The bridge imports
  it for `load_plugins` and `save_plugins`, so watch for upstream adding Qt
  imports there.
- Decky runs the backend as the deck user without root (`flags: []`). Keep
  it that way.

## Testing

```sh
git clone https://github.com/ChrisDKN/Amethyst-Mod-Manager.git amethyst
cd amethyst && pip install -r src/requirements-vendor.txt && native/amethyst_filegraph/build.sh
# optional, for loot_sort: build libloot (see Amethyst wiki "Building from source")
cd ../amethyst-deploy-decky
tests/make_fake_home.sh
AMETHYST_SRC=../amethyst/src python3 tests/bridge_smoke.py
```

Frontend: `pnpm i && pnpm build`, plus `npx tsc --noEmit --skipLibCheck -p .`.

Package: a folder named `Amethyst Deploy` containing `plugin.json`,
`package.json`, `main.py`, `LICENSE`, `dist/index.js`, and the files from
`defaults/` at the root (`amethyst_snapshot.py`, `amethyst_bridge.py`).
Zip it and install via Decky → Developer → Install Plugin from ZIP.
