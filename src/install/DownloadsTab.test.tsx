import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DownloadsTab } from "./DownloadsTab";
import type { LocalArchive } from "../shared";
import { bridgeCalls, onBridge } from "../test/deckyApi";
import { makeGame } from "../test/fixtures";
import { findRow, pressA } from "../test/gamepad";
import { settle } from "../test/settle";

const SKYUI: LocalArchive = {
  path: "/home/deck/Downloads/SkyUI_5_2_SE-12604-5-2SE.7z", name: "SkyUI_5_2_SE-12604-5-2SE.7z",
  folder: "Downloads", size: 4 * 1024 * 1024, modified: Date.now() / 1000,
};

function renderTab(archives: LocalArchive[], locked = false) {
  onBridge("local_archives", () => archives);
  onBridge("install_archive", () => ({ id: "t1" }));
  render(<DownloadsTab game={makeGame()} profile="Default" locked={locked} reload={0} />);
}

describe("DownloadsTab", () => {
  it("lists the archives in Downloads", async () => {
    renderTab([SKYUI]);
    expect(await screen.findByText(SKYUI.name)).toBeTruthy();
    expect(screen.getByText("4 MB · just now · Downloads")).toBeTruthy();
    expect(screen.getByText("A installs into Skyrim Special Edition · Default")).toBeTruthy();
  });

  it("A installs the archive into the profile", async () => {
    renderTab([SKYUI]);
    pressA(await findRow(SKYUI.name));
    await waitFor(() => expect(bridgeCalls("install_archive")).toEqual([
      { game: "Skyrim Special Edition", profile: "Default", path: SKYUI.path },
    ]));
  });

  it("A does nothing while a deploy runs", async () => {
    renderTab([SKYUI], true);
    pressA(await findRow(SKYUI.name));
    await settle();
    expect(bridgeCalls("install_archive")).toEqual([]);
    expect(screen.getByText(/A deploy is running/)).toBeTruthy();
  });

  it("says where to put archives when there are none", async () => {
    renderTab([]);
    expect(await screen.findByText(/No mod archives found\. Save mod archives to Downloads/)).toBeTruthy();
  });

  it("Refresh lists them again", async () => {
    renderTab([]);
    await screen.findByText(/No mod archives found/);
    onBridge("local_archives", () => [SKYUI]);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText(SKYUI.name)).toBeTruthy();
  });
});
