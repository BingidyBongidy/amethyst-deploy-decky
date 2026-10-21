import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Navigation } from "@decky/ui";
import { toaster } from "@decky/api";
import { GetModsTab } from "./GetModsTab";
import type { NexusCard, NexusMod } from "../shared";
import { bridgeCalls, onBridge } from "../test/deckyApi";
import { freshGame } from "../test/fixtures";
import { findRow, pressA, pressB } from "../test/gamepad";

const CARD: NexusCard = {
  id: 3863, name: "SkyUI", summary: "Elegant, PC-friendly interface", picture: "", author: "SkyUI Team",
  version: "5.2", endorsements: 120000, downloads: 9000000, category: "User Interface", updated: "2024-05-01T12:00:00Z",
};
const MOD: NexusMod = {
  ...CARD, description: "", premium: false,
  files: [{ id: 1000, name: "SkyUI 5.2", version: "5.2", category: "MAIN", file_name: "SkyUI_5_2.7z",
    size: 4 * 1024 * 1024, description: "", primary: true }],
};

/** The Get mods tab on Nexus, logged in, with SkyUI's details open. */
async function openDetails(premium: boolean) {
  onBridge("nexus_status", () => ({ logged_in: true, name: "Brad", premium }));
  onBridge("nexus_mods", () => ({ mods: [CARD], more: false }));
  onBridge("nexus_mod", () => MOD);
  const game = freshGame({ nexus_domain: "skyrimspecialedition", ts_community: "" });
  render(<GetModsTab game={game} profile="Default" locked={false} reload={0} />);
  pressA(await findRow("SkyUI"));
  const file = await findRow("SkyUI 5.2");
  return { game, file };
}

const installParams = (game: string) => ({ game, profile: "Default", mod_id: 3863, file_id: 1000, title: "SkyUI" });

describe("Nexus details", () => {
  it("loads the mod's files", async () => {
    const { game } = await openDetails(true);
    expect(bridgeCalls("nexus_mod")).toEqual([{ game: game.name, mod_id: 3863 }]);
    expect(screen.getByText("MAIN DOWNLOAD")).toBeTruthy();
  });

  it("Premium: A on a file installs it with nexus_install", async () => {
    onBridge("nexus_install", () => ({ id: "t1" }));
    const { game, file } = await openDetails(true);
    pressA(file);
    await waitFor(() => expect(bridgeCalls("nexus_install")).toEqual([installParams(game.name)]));
    expect(bridgeCalls("nexus_manual_install")).toEqual([]);
    expect(Navigation.NavigateToExternalWeb).not.toHaveBeenCalled();
  });

  it("free account: A opens the file's page in Steam's browser", async () => {
    const url = "https://www.nexusmods.com/skyrimspecialedition/mods/3863?tab=files&file_id=1000";
    onBridge("nexus_manual_install", () => ({ task: { id: "t1" }, url }));
    const { game, file } = await openDetails(false);
    expect(screen.getByText(/Free account: pressing a file opens its Nexus page/)).toBeTruthy();
    pressA(file);
    await waitFor(() => expect(Navigation.NavigateToExternalWeb).toHaveBeenCalledWith(url));
    expect(bridgeCalls("nexus_manual_install")).toEqual([installParams(game.name)]);
    expect(bridgeCalls("nexus_install")).toEqual([]);
  });

  it("free account: no url (already downloaded) doesn't open the browser", async () => {
    onBridge("nexus_manual_install", () => ({ task: { id: "t1" }, url: "" }));
    const { file } = await openDetails(false);
    pressA(file);
    await waitFor(() => expect(toaster.toast).toHaveBeenCalledWith(
      expect.objectContaining({ body: "Installing SkyUI (already in Downloads)" })));
    expect(Navigation.NavigateToExternalWeb).not.toHaveBeenCalled();
  });

  it("B goes back to the results", async () => {
    const { file } = await openDetails(true);
    pressB(file);
    expect(await screen.findByText("Elegant, PC-friendly interface")).toBeTruthy();
    expect(screen.queryByText("SkyUI 5.2")).toBeNull();
  });
});
