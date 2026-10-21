import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { routerHook, toaster } from "@decky/api";
import { Navigation } from "@decky/ui";
import plugin from "./index";
import { AmethystPage } from "./AmethystPage";
import { backendCalls, emit, listenerCount, onBridge, onCallable } from "./test/deckyApi";
import { makeGame, makeTask } from "./test/fixtures";

const steam = globalThis as any;
const SKYRIM = makeGame();

/** definePlugin's callback (the test double returns it as is). */
const definition = () => (plugin as unknown as () => any)();

describe("plugin definition", () => {
  it("adds the full-screen route and removes it on dismount", () => {
    const p = definition();
    expect(p.name).toBe("Amethyst Deploy");
    expect(routerHook.addRoute).toHaveBeenCalledWith("/amethyst", AmethystPage, { exact: true });
    expect(listenerCount("amethyst_event")).toBe(1);
    p.onDismount();
    expect(routerHook.removeRoute).toHaveBeenCalledWith("/amethyst");
    expect(listenerCount("amethyst_event")).toBe(0);
    expect(listenerCount("amethyst_done")).toBe(0);
  });

  it("toasts finished and failed installs", async () => {
    const p = definition();
    await emit("amethyst_event", "task", makeTask({ state: "done", result: { installed: ["SkyUI"] } }));
    expect(toaster.toast).toHaveBeenCalledWith(expect.objectContaining({ body: "Installed SkyUI" }));
    await emit("amethyst_event", "task", makeTask({ state: "error", error: "Bad archive" }));
    expect(toaster.toast).toHaveBeenCalledWith(expect.objectContaining({ body: "Install failed: SkyUI: Bad archive" }));
    p.onDismount();
  });

  it("Deploy & Play launches the game when the deploy finishes", async () => {
    const p = definition();
    onBridge("list_games", () => [SKYRIM]);
    onBridge("mods", () => []);
    render(<AmethystPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Deploy & Play" }));
    await waitFor(() => expect(backendCalls("start_job")).toEqual([["deploy", "skyrim_se", "Default"]]));
    expect(steam.SteamClient.Apps.RunGame).not.toHaveBeenCalled();
    await emit("amethyst_done", { action: "deploy", game: SKYRIM.name, profile: "Default", ok: true, log: [] });
    expect(steam.SteamClient.Apps.RunGame).toHaveBeenCalledWith("489830", "", -1, 100);
    p.onDismount();
  });

  it("a failed deploy doesn't launch", async () => {
    const p = definition();
    onBridge("list_games", () => [SKYRIM]);
    onBridge("mods", () => []);
    render(<AmethystPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Deploy & Play" }));
    await waitFor(() => expect(backendCalls("start_job")).toHaveLength(1));
    await emit("amethyst_done", { action: "deploy", game: SKYRIM.name, profile: "Default", ok: false, log: [] });
    expect(steam.SteamClient.Apps.RunGame).not.toHaveBeenCalled();
    p.onDismount();
  });
});

/**
 * The plugin, with the panel's cached game list cleared. The panel keeps its
 * last list for the whole session and rescans after a successful job.
 */
async function freshPanel() {
  const p = definition();
  await emit("amethyst_done", { action: "update", ok: true, log: [] });
  return p;
}

describe("Quick Access panel", () => {
  it("offers to install Amethyst when it's missing", async () => {
    onCallable("list_games", () => ({ ok: false, kind: "none", games: [], error: "" }));
    const p = await freshPanel();
    render(p.content);
    fireEvent.click(await screen.findByRole("button", { name: "Install Amethyst" }));
    await waitFor(() => expect(backendCalls("start_job")).toEqual([["install", "", ""]]));
    p.onDismount();
  });

  it("opens the full-screen page", async () => {
    onCallable("list_games", () => ({ ok: true, kind: "flatpak", games: [SKYRIM], error: "" }));
    const p = await freshPanel();
    render(p.content);
    fireEvent.click(await screen.findByRole("button", { name: "Open Amethyst (mods, plugins, setup)" }));
    expect(Navigation.Navigate).toHaveBeenCalledWith("/amethyst");
    expect(Navigation.CloseSideMenus).toHaveBeenCalled();
    p.onDismount();
  });
});
