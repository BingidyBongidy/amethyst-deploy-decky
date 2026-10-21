import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { chooseGameFolder } from "./FolderPicker";
import { bridgeCalls, onBridge } from "../test/deckyApi";
import { findRow, pressA, pressB, pressX, row } from "../test/gamepad";

const GAME = "Skyrim Special Edition";
const LISTINGS: Record<string, unknown> = {
  "": { path: "", parent: "", looks_like_game: false, folders: [
    { name: "Home", path: "/home/deck", looks_like_game: false },
    { name: "SD card", path: "/run/media/mmcblk0p1", looks_like_game: false },
  ] },
  "/home/deck": { path: "/home/deck", parent: "", looks_like_game: false, folders: [
    { name: "Games", path: "/home/deck/Games", looks_like_game: false },
    { name: "SSE", path: "/home/deck/SSE", looks_like_game: true },
  ] },
};

function openPicker() {
  onBridge("browse_folders", (p) => LISTINGS[p.path]);
  const onPick = vi.fn();
  act(() => void chooseGameFolder(GAME, onPick));
  return onPick;
}

describe("FolderPicker", () => {
  it("starts at the places games live", async () => {
    openPicker();
    expect(await screen.findByText("Home")).toBeTruthy();
    expect(bridgeCalls("browse_folders")).toEqual([{ path: "", game: GAME }]);
    expect(screen.getByText(`Choose ${GAME}'s folder`)).toBeTruthy();
    expect(screen.getByText("Pick where to start looking.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Use this folder" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("A opens a folder", async () => {
    openPicker();
    pressA(await findRow("Home"));
    expect(await screen.findByText("SSE")).toBeTruthy();
    expect(bridgeCalls("browse_folders")).toContainEqual({ path: "/home/deck", game: GAME });
    expect(screen.getByText("Up to start")).toBeTruthy();
  });

  it("X uses the highlighted folder and closes", async () => {
    const onPick = openPicker();
    pressX(await findRow("SD card"));
    expect(onPick).toHaveBeenCalledWith("/run/media/mmcblk0p1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Use this folder uses the folder you're in", async () => {
    const onPick = openPicker();
    pressA(await findRow("Home"));
    await screen.findByText("SSE");
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    expect(onPick).toHaveBeenCalledWith("/home/deck");
  });

  it("B goes up a folder", async () => {
    const onPick = openPicker();
    pressA(await findRow("Home"));
    pressB(await findRow("Games"));
    expect(await screen.findByText("SD card")).toBeTruthy();
    expect(bridgeCalls("browse_folders").map((c) => c.path)).toEqual(["", "/home/deck", ""]);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("the Up row goes up too", async () => {
    openPicker();
    pressA(await findRow("Home"));
    pressA(await findRow("Up to start"));
    expect(await screen.findByText("SD card")).toBeTruthy();
  });

  it("marks folders that look like the game", async () => {
    openPicker();
    pressA(await findRow("Home"));
    await screen.findByText("SSE");
    expect(within(row("SSE")).getByText(GAME)).toBeTruthy();
    expect(within(row("Games")).queryByText(GAME)).toBeNull();
  });

  it("Cancel closes without picking", async () => {
    const onPick = openPicker();
    await screen.findByText("Home");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onPick).not.toHaveBeenCalled();
  });

  it("shows a browse error", async () => {
    onBridge("browse_folders", () => {
      throw new Error("Permission denied");
    });
    act(() => void chooseGameFolder(GAME, vi.fn()));
    expect(await screen.findByText("Permission denied")).toBeTruthy();
  });
});
