import { addEventListener, removeEventListener, callable, toaster } from "@decky/api";
import { useEffect, useState } from "react";

export type Game = {
  name: string;
  game_id: string;
  steam_id: string;
  configured: boolean;
  profiles: string[];
  deployed_profile: string;
  deploy_active: boolean;
};
/** list_games from the bridge: a Game plus what the full UI needs. */
export type BridgeGame = Game & { active_profile: string; has_plugins: boolean; loot: boolean };
export type GamesResult = { ok: boolean; kind: string; games: Game[]; error: string };
export type JobStatus = {
  action?: string;
  game?: string;
  profile?: string;
  running?: boolean;
  ok?: boolean | null;
  log: string[];
};
export type Mod = { name: string; label: string; enabled: boolean; locked: boolean; separator: boolean };
export type PluginRow = {
  name: string;
  enabled: boolean;
  vanilla: boolean;
  master: boolean;
  light: boolean;
  missing_masters: string[];
  late_masters: string[];
};

export const listGames = callable<[], GamesResult>("list_games");
export const startJob = callable<[action: string, game: string, profile: string], { ok: boolean; error?: string }>("start_job");
export const jobStatus = callable<[], JobStatus>("job_status");
const callBridge = callable<[method: string, params: Record<string, unknown>],
  { ok: boolean; result?: unknown; error?: string }>("call");

/** Call a method on Amethyst's bridge (main.py BRIDGE_METHODS). Throws the user-facing error. */
export async function bridge<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const r = await callBridge(method, params);
  if (!r.ok) throw new Error(r.error ?? `${method} failed`);
  return r.result as T;
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const toast = (body: string, title = "Amethyst") => toaster.toast({ title, body });

declare const SteamClient: any;
declare const collectionStore: any;

// Shared by the QAM panel and the full-screen page; survives either closing.
export const selection: { game?: string; profile?: string } = {};
let pendingLaunch: string | null = null;
export const takePendingLaunch = () => {
  const id = pendingLaunch;
  pendingLaunch = null;
  return id;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Steam app ID for a game: Amethyst's own if it has one, else match by name in the library. */
export function resolveAppId(g: Game): string | null {
  if (g.steam_id) return g.steam_id;
  try {
    const apps: any[] = collectionStore?.allAppsCollection?.allApps ?? [];
    const target = norm(g.name);
    const exact = apps.find((a) => norm(a.display_name ?? "") === target);
    if (exact) return String(exact.appid);
    const loose = apps.find((a) => {
      const n = norm(a.display_name ?? "");
      return n.length > 3 && (n.includes(target) || target.includes(n));
    });
    return loose ? String(loose.appid) : null;
  } catch {
    return null;
  }
}

export function runApp(appId: string) {
  try {
    SteamClient.Apps.RunGame(appId, "", -1, 100);
  } catch (e) {
    toast(`Couldn't launch: ${e}`);
  }
}

/** Start deploy/restore; launch the game afterwards if launchAppId is set. Returns an error or null. */
export async function startGameJob(action: "deploy" | "restore", g: Game, profile: string,
                                   launchAppId: string | null = null): Promise<string | null> {
  pendingLaunch = launchAppId;
  const r = await startJob(action, g.game_id || g.name, profile);
  if (!r.ok) {
    pendingLaunch = null;
    return r.error ?? "failed";
  }
  return null;
}

/** Live job state from the backend's amethyst_log / amethyst_done events. */
export function useJob(onDone?: (s: JobStatus) => void) {
  const [job, setJob] = useState<JobStatus>({ log: [] });
  useEffect(() => {
    jobStatus().then(setJob);
    const onLog = addEventListener<[string]>("amethyst_log", (line) =>
      setJob((j) => {
        const last = j.log[j.log.length - 1];
        // collapse flatpak progress redraws into one line
        const strip = (s: string) => s.replace(/[\d.%\s/]+/g, "").slice(0, 30);
        const log = last && line.includes("%") && strip(last) === strip(line)
          ? [...j.log.slice(0, -1), line] : [...j.log, line];
        return { ...j, running: true, log: log.slice(-20) };
      }));
    const done = addEventListener<[JobStatus]>("amethyst_done", (s) => {
      setJob((j) => ({ ...j, ...s, log: j.log }));
      onDone?.(s);
    });
    return () => {
      removeEventListener("amethyst_log", onLog);
      removeEventListener("amethyst_done", done);
    };
  }, []);
  return [job, setJob] as const;
}
