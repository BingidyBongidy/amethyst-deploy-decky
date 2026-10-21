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
export const taskFinished = (task: Task) => task.state === "done" || task.state === "error" || task.state === "cancelled";

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
  const reply = await callBridge(method, params);
  if (!reply.ok) throw new Error(reply.error ?? `${method} failed`);
  return reply.result as T;
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const toast = (body: string, title = "Amethyst", onClick?: () => void) =>
  toaster.toast({ title, body, onClick });

/** Start an install task; the task tray takes it from there. */
export async function startInstall(method: string, params: Record<string, unknown>, name: string) {
  try {
    await bridge<Task>(method, params);
    toast(`Installing ${name}`);
  } catch (e) {
    toast(errText(e));
  }
}

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

/** "Some Game: GOTY" -> "somegamegoty", for loose name matching. */
const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * What to pass to RunGame for a game: its non-Steam shortcut (Unifideck and
 * friends) when it has one, else Amethyst's Steam app ID, else a name match
 * in the library. Shortcuts launch by game ID, not app ID.
 */
export function launchId(game: Game): string | null {
  if (game.shortcut_appid) return ((BigInt(game.shortcut_appid) << 32n) | 0x02000000n).toString();
  if (game.steam_id) return game.steam_id;
  try {
    return libraryAppIdByName(game.name);
  } catch {
    return null;
  }
}

/** The Steam library app whose name matches: exactly if possible, else one containing the other. */
function libraryAppIdByName(name: string): string | null {
  const apps: any[] = collectionStore?.allAppsCollection?.allApps ?? [];
  const target = normalizeName(name);
  const exact = apps.find((app) => normalizeName(app.display_name ?? "") === target);
  if (exact) return String(exact.appid);
  const loose = apps.find((app) => {
    const appName = normalizeName(app.display_name ?? "");
    return appName.length > 3 && (appName.includes(target) || target.includes(appName));
  });
  return loose ? String(loose.appid) : null;
}

export function runApp(appId: string) {
  try {
    SteamClient.Apps.RunGame(appId, "", -1, 100);
  } catch (e) {
    toast(`Couldn't launch: ${e}`);
  }
}

/** Start deploy/restore; launch the game afterwards if launchAppId is set. Returns an error or null. */
export async function startGameJob(action: "deploy" | "restore", game: Game, profile: string,
                                   launchAppId: string | null = null): Promise<string | null> {
  pendingLaunch = launchAppId;
  const reply = await startJob(action, game.game_id || game.name, profile);
  if (!reply.ok) {
    pendingLaunch = null;
    return reply.error ?? "failed";
  }
  return null;
}

/** Flatpak redraws its progress line; a redraw replaces the last line instead of adding one. */
function appendLogLine(log: string[], line: string): string[] {
  const last = log[log.length - 1];
  const withoutNumbers = (text: string) => text.replace(/[\d.%\s/]+/g, "").slice(0, 30);
  const isRedraw = last && line.includes("%") && withoutNumbers(last) === withoutNumbers(line);
  const next = isRedraw ? [...log.slice(0, -1), line] : [...log, line];
  return next.slice(-20);
}

/** Live job state from the backend's amethyst_log / amethyst_done events. */
export function useJob(onDone?: (status: JobStatus) => void) {
  const [job, setJob] = useState<JobStatus>({ log: [] });
  // Listeners are added once; the ref lets them call the latest onDone.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    jobStatus().then(setJob);
    const onLog = addEventListener<[string]>("amethyst_log", (line) =>
      setJob((current) => ({ ...current, running: true, log: appendLogLine(current.log, line) })));
    const onFinished = addEventListener<[JobStatus]>("amethyst_done", (status) => {
      setJob((current) => ({ ...current, ...status, log: current.log }));
      onDoneRef.current?.(status);
    });
    return () => {
      removeEventListener("amethyst_log", onLog);
      removeEventListener("amethyst_done", onFinished);
    };
  }, []);
  return [job, setJob] as const;
}

/** Bridge events (task progress, Nexus login) forwarded by main.py as amethyst_event. */
export function useBridgeEvent(handler: (event: string, data: any) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener = addEventListener<[string, any]>("amethyst_event", (event, data) => ref.current(event, data));
    return () => {
      removeEventListener("amethyst_event", listener);
    };
  }, []);
}

/** Update a task in place, or append a new id, so rows keep their order. */
function upsertTask(tasks: Task[], task: Task): Task[] {
  if (!tasks.some((t) => t.id === task.id)) return [...tasks, task];
  return tasks.map((t) => (t.id === task.id ? task : t));
}

/**
 * Merge the first "tasks" reply into the list. Everything already in `current`
 * came from a "task" event that arrived while the request was in flight, so it's
 * newer than the reply: events win for their ids, the reply fills in the rest.
 */
export function mergeTaskReply(reply: Task[], current: Task[]): Task[] {
  const fromEvents = new Map(current.map((t) => [t.id, t]));
  const merged = reply.map((t) => fromEvents.get(t.id) ?? t);
  const replyIds = new Set(reply.map((t) => t.id));
  return [...merged, ...current.filter((t) => !replyIds.has(t.id))];
}

const helperStopped = (task: Task): Task =>
  (taskFinished(task) ? task : { ...task, state: "error", error: "Amethyst's helper stopped." });

/** Live list of bridge tasks: loads once, then follows "task" events. */
export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  useEffect(() => {
    bridge<Task[]>("tasks").then((reply) => setTasks((current) => mergeTaskReply(reply, current)), () => {});
  }, []);
  useBridgeEvent((event, data) => {
    if (event === "task") {
      setTasks((current) => upsertTask(current, data as Task));
    } else if (event === "bridge_stopped") {
      setTasks((current) => current.map(helperStopped));
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
