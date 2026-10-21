import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Navigation } from "@decky/ui";
import { GetModsTab } from "./GetModsTab";
import type { BridgeGame } from "../shared";
import { bridgeCalls, emit, onBridge } from "../test/deckyApi";
import { freshGame } from "../test/fixtures";
import { choose, dropdownWith } from "../test/gamepad";
import { settle } from "../test/settle";

const NEXUS_ONLY = { nexus_domain: "skyrimspecialedition", ts_community: "" };
const TS_ONLY = { nexus_domain: "", ts_community: "valheim" };
const NEITHER = { nexus_domain: "", ts_community: "" };

function renderTab(game: BridgeGame) {
  const onOpenDownloads = vi.fn();
  render(<GetModsTab game={game} profile="Default" locked={false} reload={0} onOpenDownloads={onOpenDownloads} />);
  return { onOpenDownloads };
}

const sitePicker = () => dropdownWith("Site: Other sites");
const siteLabels = () => Array.from(sitePicker().options).map((o) => o.textContent);

describe("GetModsTab: site picker", () => {
  it.each([
    ["Nexus only", NEXUS_ONLY, ["Site: Nexus Mods", "Site: Thunderstore (not for this game)", "Site: Other sites"]],
    ["Thunderstore only", TS_ONLY, ["Site: Nexus Mods (not for this game)", "Site: Thunderstore", "Site: Other sites"]],
    ["neither", NEITHER, ["Site: Nexus Mods (not for this game)", "Site: Thunderstore (not for this game)", "Site: Other sites"]],
  ])("always lists all three sites (%s)", async (_, sites, labels) => {
    onBridge("nexus_status", () => ({ logged_in: false }));
    onBridge("ts_mods", () => ({ mods: [], more: false }));
    renderTab(freshGame(sites));
    await settle();
    expect(siteLabels()).toEqual(labels);
  });

  it("starts on Other sites for a game on neither site", () => {
    renderTab(freshGame(NEITHER));
    expect(screen.getByText("Mods from other sites")).toBeTruthy();
  });

  it("picking Thunderstore for a Nexus-only game says it isn't there", async () => {
    onBridge("nexus_status", () => ({ logged_in: false }));
    const game = freshGame({ name: "Skyrim", ...NEXUS_ONLY });
    renderTab(game);
    choose(sitePicker(), "Site: Thunderstore (not for this game)");
    expect(await screen.findByText(`${game.name} isn't on Thunderstore`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Browse Nexus Mods" }));
    expect(await screen.findByText("Log in to Nexus Mods")).toBeTruthy();
  });

  it("remembers the picked site for the game", async () => {
    onBridge("nexus_status", () => ({ logged_in: false }));
    const game = freshGame(NEXUS_ONLY);
    const first = render(<GetModsTab game={game} profile="Default" locked={false} reload={0} />);
    await settle();
    choose(sitePicker(), "Site: Other sites");
    first.unmount();
    renderTab(game);
    expect(screen.getByText("Mods from other sites")).toBeTruthy();
  });
});

describe("GetModsTab: Other sites", () => {
  it("explains the Downloads tab and opens it", async () => {
    onBridge("nexus_status", () => ({ logged_in: false }));
    const { onOpenDownloads } = renderTab(freshGame(NEXUS_ONLY));
    await settle();
    choose(sitePicker(), "Site: Other sites");
    expect(screen.getByText(/Save it to your Downloads folder/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open the Downloads tab" }));
    expect(onOpenDownloads).toHaveBeenCalledTimes(1);
  });

  it("has the mod.io note for Baldur's Gate 3", async () => {
    onBridge("nexus_status", () => ({ logged_in: false }));
    renderTab(freshGame({ name: "Baldur's Gate 3", nexus_domain: "baldursgate3", ts_community: "" }));
    await settle();
    choose(sitePicker(), "Site: Other sites");
    expect(screen.getByText(/mods from mod\.io, the game's official mod site/)).toBeTruthy();
  });

  it("has no mod.io note for other games", () => {
    renderTab(freshGame(NEITHER));
    expect(screen.queryByText(/mod\.io/)).toBeNull();
  });
});

describe("GetModsTab: Nexus login", () => {
  const URL = "https://www.nexusmods.com/oauth/authorize?client_id=amethyst";

  it("shows the login screen when not logged in", async () => {
    onBridge("nexus_status", () => ({ logged_in: false }));
    renderTab(freshGame(NEXUS_ONLY));
    expect(await screen.findByText("Log in to Nexus Mods")).toBeTruthy();
    expect(bridgeCalls("nexus_mods")).toEqual([]);
  });

  it("Log in opens Nexus's page in Steam's browser", async () => {
    onBridge("nexus_status", () => ({ logged_in: false }));
    onBridge("nexus_login_start", () => ({ url: URL }));
    renderTab(freshGame(NEXUS_ONLY));
    fireEvent.click(await screen.findByRole("button", { name: "Log in" }));
    await waitFor(() => expect(Navigation.NavigateToExternalWeb).toHaveBeenCalledWith(URL));
    expect(bridgeCalls("nexus_login_start")).toHaveLength(1);
    expect(screen.getByText(/Waiting for you to press Authorize/)).toBeTruthy();
  });

  it("switches to the mod list when the login event arrives", async () => {
    onBridge("nexus_status", () => ({ logged_in: false }));
    onBridge("nexus_login_start", () => ({ url: URL }));
    onBridge("nexus_mods", () => ({ mods: [], more: false }));
    renderTab(freshGame(NEXUS_ONLY));
    fireEvent.click(await screen.findByRole("button", { name: "Log in" }));
    await screen.findByText(/Waiting for you to press Authorize/);
    await emit("amethyst_event", "nexus_login", { logged_in: true, name: "Brad", premium: true });
    expect(await screen.findByText("No mods found.")).toBeTruthy();
    expect(screen.getByText(/Brad/)).toBeTruthy();
  });

  it("shows a failed login's error", async () => {
    onBridge("nexus_status", () => ({ logged_in: false }));
    renderTab(freshGame(NEXUS_ONLY));
    await screen.findByText("Log in to Nexus Mods");
    await emit("amethyst_event", "nexus_login", { logged_in: false, error: "Authorization was denied." });
    expect(screen.getByText("Authorization was denied.")).toBeTruthy();
  });
});
