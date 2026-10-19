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
  - `list_games`, `detect_installed` (Steam libraries + appmanifest)
  - `configure_game`: game path, Proton prefix and profile structure, the
    same steps as the GUI's Configure Game dialog for a Steam install
  - `create_profile`
  - `mods`, `set_mod_enabled` (also syncs plugins.txt), `move_mod`
  - `plugins`, `set_plugin_enabled`, `move_plugin` (refuses moves that put a
    plugin above its masters, like the GUI)
  - `loot_sort`: mirrors the GUI's Sort Plugins
- `tests/bridge_smoke.py` + `tests/make_fake_home.sh` exercise all of that
  against real Amethyst source with a fake Steam library holding Skyrim SE.
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

### 3. Phase 2: Nexus
- Login: Nexus SSO (Amethyst has `Nexus/nexus_oauth.py`) opened in Steam's
  browser; the token goes in the keyring the same way the GUI stores it.
- Search, browse and install. Premium accounts can use direct API downloads.
  Free accounts need the `nxm://` key or a manual download, depending on
  what step 1 found. `Nexus/manual_download_watch.py` is Amethyst's own
  free-user flow and can be reused.
- Install pipeline: `Utils/mods/install.py`. FOMOD: `Utils/fomod/installer.py`,
  rendered as controller pages, one step per page.

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
