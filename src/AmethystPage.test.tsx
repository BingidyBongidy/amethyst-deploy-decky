import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { toaster } from "@decky/api";
import { AmethystPage } from "./AmethystPage";
import type { BridgeGame, Mod } from "./shared";
import { bridgeCalls, onBridge } from "./test/deckyApi";
import { makeGame, makeMod, makePlugin } from "./test/fixtures";
import { settle } from "./test/settle";
import { findRow, focusableOf, pressA, pressX, pressY } from "./test/gamepad";

const SKYRIM = makeGame();
const where = { game: SKYRIM.name, profile: "Default" };

function setup(games: BridgeGame[] = [SKYRIM]) {
  let mods: Mod[] = [makeMod("SkyUI"), makeMod("USSEP", { enabled: false })];
  onBridge("list_games", () => games);
  onBridge("mods", () => mods);
  onBridge("set_mod_enabled", (p) => {
    mods = mods.map((m) => (m.name === p.name ? { ...m, enabled: p.enabled } : m));
    return mods;
  });
  onBridge("remove_mod", (p) => {
    mods = mods.filter((m) => m.name !== p.name);
    return mods;
  });
  onBridge("plugins", () => [makePlugin("SkyUI_SE.esp")]);
  onBridge("detect_installed", () => [{ name: "Fallout 4", launchers: ["steam"] }]);
  render(<AmethystPage />);
}

const openTab = async (name: string) => fireEvent.click(await screen.findByRole("tab", { name }));

describe("AmethystPage: Mods tab", () => {
  it("lists the profile's mods", async () => {
    setup();
    expect(await screen.findByText("SkyUI")).toBeTruthy();
    expect(screen.getByText("USSEP")).toBeTruthy();
    expect(bridgeCalls("mods")).toContainEqual(where);
  });

  it("A toggles a mod with set_mod_enabled", async () => {
    setup();
    pressA(await findRow("SkyUI"));
    await waitFor(() => expect(bridgeCalls("set_mod_enabled")).toEqual([{ ...where, name: "SkyUI", enabled: false }]));
  });

  it("Y then Uninstall removes a mod", async () => {
    setup();
    pressY(await findRow("USSEP"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Uninstall USSEP?")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Uninstall" }));
    await waitFor(() => expect(bridgeCalls("remove_mod")).toEqual([{ ...where, name: "USSEP" }]));
    await waitFor(() => expect(screen.queryByText("USSEP")).toBeNull());
  });

  it("Cancel in the uninstall prompt keeps the mod", async () => {
    setup();
    pressY(await findRow("USSEP"));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(bridgeCalls("remove_mod")).toEqual([]);
  });
});

describe("AmethystPage: Load order tab", () => {
  const folderCheck = (expected: string[]) => ({
    game_path: "/games/Skyrim", data_path: "/games/Skyrim/Data", data_exists: true,
    expected, game_folder: ["Data", "SkyrimSE.exe"], data_folder: ["SkyUI_SE.esp"],
  });
  const WARNING = /The base game's files .* weren't found/;

  it("warns when the game expects base-game plugins and none are there", async () => {
    onBridge("game_folder_check", () => folderCheck(["Skyrim.esm", "Update.esm"]));
    setup();
    await openTab("Load order");
    expect(await screen.findByText(WARNING)).toBeTruthy();
    expect(screen.getByText(/Skyrim\.esm, Update\.esm/)).toBeTruthy();
    expect(bridgeCalls("game_folder_check")).toEqual([{ game: SKYRIM.name }]);
  });

  it("doesn't warn when the game has no base-game plugin list", async () => {
    onBridge("game_folder_check", () => folderCheck([]));
    setup();
    await openTab("Load order");
    await screen.findByText("SkyUI_SE.esp");
    await waitFor(() => expect(bridgeCalls("game_folder_check")).toHaveLength(1));
    await settle();
    expect(screen.queryByText(WARNING)).toBeNull();
  });

  it("doesn't check the folder when a base-game plugin is there", async () => {
    onBridge("game_folder_check", () => folderCheck(["Skyrim.esm"]));
    setup();
    onBridge("plugins", () => [makePlugin("Skyrim.esm", { vanilla: true }), makePlugin("SkyUI_SE.esp")]);
    await openTab("Load order");
    await screen.findByText("Skyrim.esm");
    expect(bridgeCalls("game_folder_check")).toEqual([]);
    expect(screen.queryByText(WARNING)).toBeNull();
  });

  it("isn't offered for games without plugins", async () => {
    setup([makeGame({ has_plugins: false })]);
    await screen.findByRole("tab", { name: "Mods" });
    expect(screen.queryByRole("tab", { name: "Load order" })).toBeNull();
  });
});

describe("AmethystPage: Setup tab", () => {
  const SET_UP = { configured: true, path: "/games/Fallout 4", prefix: "/pfx", source: "steam", needs_first_launch: false };
  const FOLDERS = {
    path: "", parent: "", looks_like_game: false,
    folders: [{ name: "Fallout 4", path: "/games/Fallout 4", looks_like_game: false }],
  };

  it("Set up calls configure_game and reloads the games", async () => {
    onBridge("configure_game", () => SET_UP);
    setup();
    await openTab("Setup");
    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));
    await waitFor(() => expect(bridgeCalls("configure_game")).toEqual([{ game: "Fallout 4" }]));
    await waitFor(() => expect(toaster.toast).toHaveBeenCalledWith(
      expect.objectContaining({ body: "Fallout 4 is set up (Steam): /games/Fallout 4" })));
    await waitFor(() => expect(bridgeCalls("list_games")).toHaveLength(2));
  });

  it("a folder that doesn't look right asks first, and OK forces it", async () => {
    onBridge("browse_folders", () => FOLDERS);
    onBridge("configure_game", (p) => (p.force ? SET_UP
      : { ...SET_UP, configured: false, needs_confirm: true, message: "No Fallout4.exe in this folder." }));
    setup();
    await openTab("Setup");
    fireEvent.click(await screen.findByRole("button", { name: "Choose folder…" }));
    const picker = await screen.findByRole("dialog");
    pressX(focusableOf(await within(picker).findByText("Fallout 4")));
    expect(await screen.findByText("Use this folder anyway?")).toBeTruthy();
    expect(screen.getByText("No Fallout4.exe in this folder.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use it anyway" }));
    await waitFor(() => expect(bridgeCalls("configure_game")).toEqual([
      { game: "Fallout 4", path: "/games/Fallout 4", force: false },
      { game: "Fallout 4", path: "/games/Fallout 4", force: true },
    ]));
  });

  it("a failed setup stays on screen with Choose folder…", async () => {
    onBridge("configure_game", () => {
      throw new Error("Couldn't find the game's folder.");
    });
    onBridge("browse_folders", () => FOLDERS);
    setup();
    await openTab("Setup");
    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));
    const error = await screen.findByText(/Couldn't set up Fallout 4: Couldn't find the game's folder\./);
    // Still there after the rest of the page settles.
    await settle();
    expect(screen.getByText(/Couldn't set up Fallout 4/)).toBeTruthy();
    fireEvent.click(within(focusableOf(error)).getByRole("button", { name: "Choose folder…" }));
    expect(await screen.findByText("Choose Fallout 4's folder")).toBeTruthy();
  });

  it("opens on Setup when no game is set up yet", async () => {
    setup([makeGame({ configured: false })]);
    expect(await screen.findByRole("tab", { name: "Setup", selected: true })).toBeTruthy();
    expect(await screen.findByText("Fallout 4")).toBeTruthy();
  });
});

describe("AmethystPage: Get mods tab", () => {
  it.each([
    ["a Nexus game", makeGame()],
    ["a game on no mod site", makeGame({ nexus_domain: "", ts_community: "" })],
    ["no game set up", makeGame({ configured: false })],
  ])("is there for %s", async (_, game) => {
    setup([game]);
    expect(await screen.findByRole("tab", { name: "Get mods" })).toBeTruthy();
  });

  it("Other sites opens the Downloads tab", async () => {
    onBridge("local_archives", () => []);
    setup([makeGame({ name: "Stardew Valley", nexus_domain: "", ts_community: "" })]);
    await openTab("Get mods");
    fireEvent.click(await screen.findByRole("button", { name: "Open the Downloads tab" }));
    expect(await screen.findByRole("tab", { name: "Downloads", selected: true })).toBeTruthy();
    expect(await screen.findByText(/No mod archives found/)).toBeTruthy();
  });
});
