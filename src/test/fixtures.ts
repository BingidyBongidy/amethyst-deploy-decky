/** Sample data shaped like the bridge's replies (types from shared.tsx). */
import type { BridgeGame, Mod, PluginRow, Task } from "../shared";

export function makeGame(over: Partial<BridgeGame> = {}): BridgeGame {
  return {
    name: "Skyrim Special Edition", game_id: "skyrim_se", steam_id: "489830",
    configured: true, profiles: ["Default"], deployed_profile: "", deploy_active: false,
    active_profile: "Default", has_plugins: true, loot: true,
    nexus_domain: "skyrimspecialedition", ts_community: "",
    ...over,
  };
}

export const makeMod = (name: string, over: Partial<Mod> = {}): Mod => ({
  name, label: name, enabled: true, locked: false, separator: false, ...over,
});

export const makePlugin = (name: string, over: Partial<PluginRow> = {}): PluginRow => ({
  name, enabled: true, vanilla: false, master: false, light: false, missing_masters: [], late_masters: [], ...over,
});

export function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: "t1", kind: "archive", title: "SkyUI", game: "Skyrim Special Edition", profile: "Default",
    state: "working", step: "Extracting", progress: null, choice: null, result: null, error: "",
    ...over,
  };
}

/** A promise you resolve or reject from the test. */
export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let gameSerial = 0;
/**
 * A game with a name no other test used. GetModsTab remembers the picked site
 * and the search results per game name for as long as the module lives.
 */
export const freshGame = (over: Partial<BridgeGame> = {}) =>
  makeGame({ ...over, name: `${over.name ?? "Game"} #${++gameSerial}` });
