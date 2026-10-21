/**
 * Test double for `@decky/api`. callable(name) routes to `backend`, a fake of
 * main.py that each test configures:
 *
 *   onBridge("mods", (params) => [...])   // a bridge RPC (main.py's `call`)
 *   onCallable("list_games", () => ...)   // a direct backend method
 *   bridgeCalls("set_mod_enabled")        // params of every call so far
 *   await emit("amethyst_event", "task", task)
 *
 * A bridge handler that throws becomes { ok: false, error: message }, the way
 * main.py reports errors. A bridge method with no handler fails the same way.
 */
import { act } from "react";
import { vi } from "vitest";
import { settle } from "./settle";

type BridgeHandler = (params: Record<string, any>) => unknown;
type CallableHandler = (...args: any[]) => unknown;

const bridgeHandlers = new Map<string, BridgeHandler>();
const callableHandlers = new Map<string, CallableHandler>();
const calls: { method: string; params: Record<string, any> }[] = [];
const callableCalls: { name: string; args: any[] }[] = [];
const listeners = new Map<string, Set<(...args: any[]) => void>>();

export function onBridge(method: string, handler: BridgeHandler) {
  bridgeHandlers.set(method, handler);
}
export function onCallable(name: string, handler: CallableHandler) {
  callableHandlers.set(name, handler);
}
/** The params of every bridge call to `method`, oldest first. */
export const bridgeCalls = (method: string) => calls.filter((c) => c.method === method).map((c) => c.params);
/** The arguments of every direct call to a backend method (list_games, start_job...). */
export const backendCalls = (name: string) => callableCalls.filter((c) => c.name === name).map((c) => c.args);
/** Every bridge method called, in order. */
export const bridgeMethodsCalled = () => calls.map((c) => c.method);

/** Replies arrive on a later turn of the event loop, like real IPC. */
const nextTurn = () => new Promise((r) => setTimeout(r, 0));

async function callBridge(method: string, params: Record<string, any> = {}) {
  calls.push({ method, params });
  await nextTurn();
  const handler = bridgeHandlers.get(method);
  if (!handler) return { ok: false, error: `fake backend: no handler for ${method}` };
  try {
    return { ok: true, result: await handler(params) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function callable(name: string) {
  return vi.fn(async (...args: any[]) => {
    if (name === "call") return callBridge(args[0], args[1]);
    callableCalls.push({ name, args });
    const handler = callableHandlers.get(name);
    if (!handler) throw new Error(`fake backend: no callable ${name}`);
    return handler(...args);
  });
}

export function addEventListener(event: string, fn: (...args: any[]) => void) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(fn);
  return fn;
}
export function removeEventListener(event: string, fn: (...args: any[]) => void) {
  listeners.get(event)?.delete(fn);
}
export const listenerCount = (event: string) => listeners.get(event)?.size ?? 0;

/** Fire a backend event (decky.emit in main.py) at every listener, inside act,
 * and let the bridge calls it sets off answer before returning. */
export async function emit(event: string, ...args: any[]) {
  await act(async () => {
    for (const fn of [...(listeners.get(event) ?? [])]) fn(...args);
  });
  // Effects of that update run as the act ends; let the bridge calls they make answer.
  await settle();
}

export const toaster = { toast: vi.fn() };
export const routerHook = { addRoute: vi.fn(), removeRoute: vi.fn() };
export const definePlugin = <T>(fn: T) => fn;

/** beforeEach: forget handlers and calls, and install the defaults every page needs. */
export function resetBackend() {
  bridgeHandlers.clear();
  callableHandlers.clear();
  calls.length = 0;
  callableCalls.length = 0;
  listeners.clear();
  onBridge("tasks", () => []);
  onCallable("job_status", () => ({ log: [] }));
  onCallable("start_job", () => ({ ok: true }));
  onCallable("list_games", () => ({ ok: true, kind: "flatpak", games: [], error: "" }));
}
