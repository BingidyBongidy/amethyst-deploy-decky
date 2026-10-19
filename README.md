# Amethyst Deploy

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin that runs
[Amethyst Mod Manager](https://github.com/ChrisDKN/Amethyst-Mod-Manager) from Gaming Mode
with a controller. Set up games, find and install mods, sort the load order and play,
without going to Desktop Mode. It drives Amethyst's own code; it doesn't modify or bundle
Amethyst.

## What it does

- **Quick Access menu:** pick a game and profile, then **Deploy & Play**, **Deploy only**
  or **Restore vanilla**. **Open Amethyst** opens the full-screen view.
- **Mods:** turn mods on and off (A), move them (X, then the D-pad, then A), uninstall (Y).
- **Load order** (Bethesda games): plugin order, master warnings and **Sort with LOOT**.
- **Get mods:** browse and search Nexus Mods and Thunderstore.
  - Nexus login: scan a QR code with your phone and paste your API key, or type it in.
  - Nexus Premium installs in one press.
  - Free accounts press the file's **Slow download** on the Nexus page in Steam's
    browser (one trackpad click). The mod installs as soon as the download finishes.
  - Thunderstore mods install in one press, with their dependencies.
- **Downloads:** install any mod archive saved to `~/Downloads`.
- **FOMOD and BAIN installers** show their options as controller pages.
- **Setup:** find installed games and set them up for Amethyst. It finds games from
  Steam, Heroic, Unifideck, Lutris, Faugus, Bottles and non-Steam shortcuts. Create
  profiles here too.

## Requirements

- Amethyst's Flatpak. If it isn't installed, the plugin offers to install the official
  Flatpak from the developer's own remote, and shows an **Update Amethyst** button once
  it's there. The AppImage in `~/Applications` works for deploy and restore only.
- For Nexus: a Nexus Mods account. To download with a free account, log in to the Nexus
  website once in Steam's browser.

## Install

1. Decky → Settings → General → enable Developer mode
2. Developer → Install Plugin from ZIP → pick the release zip

## Build

```sh
pnpm i
pnpm build
```

Package `plugin.json`, `package.json`, `main.py`, `LICENSE`, `dist/index.js` and every
`defaults/*.py` (at the plugin root) into a folder named `Amethyst Deploy`, then zip it.

## How it works

- `main.py` (Decky backend) runs Amethyst's CLI for deploy and restore, installs the
  Flatpak, and talks to the bridge. Host commands get a clean environment, because
  Decky's bundled `LD_LIBRARY_PATH` breaks host binaries.
- `defaults/amethyst_bridge.py` runs inside Amethyst's Flatpak Python and imports
  Amethyst's own modules, so the plugin behaves like Amethyst's GUI. It covers games,
  mods, plugins and setup.
  - `amethyst_tasks.py`: background installs and downloads.
  - `amethyst_sources.py`: Nexus and Thunderstore.
  - `amethyst_unifideck.py`: Unifideck installs.
- `src/` is the React frontend, built with Steam-native components for controller use.

Testing and the current plan are in [PLAN.md](PLAN.md).

## Licence

GPL-3.0-or-later, matching Amethyst Mod Manager.
