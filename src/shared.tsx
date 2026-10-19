import { addEventListener, removeEventListener, callable, toaster } from "@decky/api";
import { useEffect, useRef, useState } from "react";

export type Game = {
  name: string;
  game_id: string;
  steam_id: string;
  configured: boolean;
  profiles: string[];
  deployed_profile: string;
  deploy_active: boolean;
  /** Non-Steam shortcut id (Unifideck etc.), "" when the game launches as a Steam app. */
  shortcut_appid?: string;
};
/** list_games from the bridge: a Game plus what the full UI needs. */
export type BridgeGame = Game & {
  active_profile: string; has_plugins: boolean; loot: boolean;
  /** Nexus game domain ("" when the game isn't on Nexus). */
  nexus_domain: string;
  /** Thunderstore community slug ("" when the game isn't on Thunderstore). */
  ts_community: string;
  /** Non-Steam shortcut (e.g. Unifideck): launch through this, not steam_id. */
  shortcut_appid: string;
};

// ---------- background tasks (bridge: defaults/amethyst_tasks.py) ----------

export type TaskState = "working" | "choice" | "done" | "error" | "cancelled";
/** What a task in state "choice" is waiting for. Answer with task_answer. */
export type TaskChoice =
  /** Open fomod_view / fomod_toggle; answer "install" (or task_cancel). */
  | { kind: "fomod"; title: string }
  /** Answer the list of selected package names. */
  | { kind: "bain"; mod: string; readme: string; packages: { name: string; label: string; default: boolean }[] }
  /** Answer "replace" or "rename" (keep both); anything else cancels. */
  | { kind: "exists"; mod: string }
  /** Thunderstore dependencies to add. Answer the list of ids to install. */
  | { kind: "deps"; mod: string; packages: { id: string; label: string; version: string; author: string }[] };
export type Task = {
  id: string;
  kind: "archive" | "nexus" | "thunderstore";
  title: string;
  game: string;
  profile: string;
  state: TaskState;
  step: string;
  /** [done, total] bytes or items; total 0 = unknown. */
  progress: [number, number] | null;
  choice: TaskChoice | null;
  result: { installed: string[] } | null;
  error: string;
};
export const taskFinished = (t: Task) => t.state === "done" || t.state === "error" || t.state === "cancelled";

export type FomodOption = {
  name: string; description: string; image: boolean; selected: boolean;
  /** Required | Recommended | Optional | CouldBeUsable | NotUsable */
  type: string; locked: boolean; missing: boolean; previous: boolean;
};
export type FomodGroup = { name: string; type: string; options: FomodOption[] };
/** steps are the VISIBLE steps; `index` is the step index fomod_toggle takes. */
export type FomodView = {
  title: string;
  steps: { index: number; name: string; groups: FomodGroup[] }[];
  errors: { step: number; message: string }[];
};

export type LocalArchive = { path: string; name: string; folder: string; size: number; modified: number };

// ---------- mod sources (bridge: defaults/amethyst_sources.py) ----------

export type NexusStatus = { logged_in: boolean; name?: string; premium?: boolean; error?: string };
export type NexusCard = {
  id: number; name: string; summary: string; picture: string; author: string; version: string;
  endorsements: number; downloads: number; category: string; updated: string;
};
export type NexusFile = {
  id: number; name: string; version: string; category: string; file_name: string;
  size: number; description: string; primary: boolean;
};
export type NexusMod = NexusCard & { description: string; files: NexusFile[]; premium: boolean };
export type TsCard = {
  namespace: string; name: string; label: string; summary: string; picture: string; author: string;
  downloads: number; rating: number; size: number; updated: string;
};
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
declare const appStore: any;

// Shared by the QAM panel and the full-screen page; survives either closing.
export const selection: { game?: string; profile?: string } = {};
let pendingLaunch: string | null = null;
export const takePendingLaunch = () => {
  const id = pendingLaunch;
  pendingLaunch = null;
  return id;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * What to pass to RunGame for a game: its non-Steam shortcut (Unifideck and
 * friends) when it has one, else Amethyst's Steam app ID, else a name match
 * in the library. Shortcuts launch by game ID, not app ID.
 */
export function resolveAppId(g: Game & { shortcut_appid?: string }): string | null {
  if (g.shortcut_appid) {
    try {
      const ov = appStore?.GetAppOverviewByAppID?.(Number(g.shortcut_appid));
      if (ov?.m_gameid) return String(ov.m_gameid);
    } catch { /* fall through to computing it */ }
    return ((BigInt(g.shortcut_appid) << 32n) | 0x02000000n).toString();
  }
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

/** Bridge events (task progress, Nexus login) forwarded by main.py as amethyst_event. */
export function useBridgeEvent(handler: (event: string, data: any) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const l = addEventListener<[string, any]>("amethyst_event", (e, d) => ref.current(e, d));
    return () => { removeEventListener("amethyst_event", l); };
  }, []);
}

/** Live list of bridge tasks: loads once, then follows "task" events. */
export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  useEffect(() => {
    bridge<Task[]>("tasks").then(setTasks, () => {});
  }, []);
  useBridgeEvent((event, data) => {
    if (event === "task") {
      setTasks((ts) => [...ts.filter((t) => t.id !== data.id), data as Task]);
    } else if (event === "bridge_stopped") {
      setTasks((ts) => ts.map((t) => taskFinished(t) ? t
        : { ...t, state: "error", error: "Amethyst's helper stopped." }));
    }
  });
  return tasks;
}

/** Props every content tab of the full-screen page gets. */
export type TabProps = {
  game: BridgeGame;
  profile: string;
  /** A deploy/restore job is running: bridge calls are refused, don't start anything. */
  locked: boolean;
  /** Bumps after deploys and finished installs; reload anything that depends on mods. */
  reload: number;
};
