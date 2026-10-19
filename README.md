# Amethyst Deploy

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin for deploying
[Amethyst Mod Manager](https://github.com/ChrisDKN/Amethyst-Mod-Manager) profiles from Gaming Mode.

Pick a game and profile in the Quick Access menu, then **Deploy & Play**, **Deploy only** or
**Restore vanilla**. It wraps Amethyst's own CLI; it doesn't modify or bundle Amethyst.

Installing mods, collections and load order still happen in the Amethyst GUI in Desktop Mode.

## Requirements

- Amethyst as the Flatpak or the AppImage in `~/Applications`. If neither is found, the
  plugin offers to install the official Flatpak from the developer's own remote, and
  shows an **Update Amethyst** button once it's there.
- At least one game configured in Amethyst, with a profile. First-time setup (game path,
  Nexus login, installing mods) is done in the Amethyst GUI in Desktop Mode.

## Install

1. Decky → Settings → General → enable Developer mode
2. Developer → Install Plugin from ZIP → pick the release zip

## Build

```sh
pnpm i
pnpm build
```

Package `plugin.json`, `package.json`, `main.py`, `LICENSE`, `defaults/amethyst_snapshot.py`
(at the plugin root) and `dist/index.js` into a folder named `Amethyst Deploy`, then zip it.

## How it works

- `main.py` finds the install (Flatpak first, then AppImage), and runs
  `list-games` / `list-profiles` / `deploy` / `restore` with a clean environment
  (Decky's bundled `LD_LIBRARY_PATH` breaks host binaries).
- With the Flatpak, `amethyst_snapshot.py` runs inside Amethyst's own Python to get
  every game's profiles, deploy state and Steam app ID in one call.
- The frontend launches the game via `SteamClient.Apps.RunGame` once a deploy succeeds.
