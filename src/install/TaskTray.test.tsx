import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskTray } from "./TaskTray";
import type { TaskChoice } from "../shared";
import { bridgeCalls, emit, onBridge } from "../test/deckyApi";
import { openModalCount } from "../test/deckyUi";
import { makeGame } from "../test/fixtures";
import { pressA, pressB, row } from "../test/gamepad";
import { settle } from "../test/settle";
import { fakeTasks, freshTaskId } from "../test/tasks";

/** The tray, after its first tasks load (a task event that beats that load is lost; see the report). */
async function renderTray() {
  onBridge("task_answer", () => ({}));
  onBridge("task_cancel", () => ({}));
  const backend = fakeTasks();
  render(<TaskTray game={makeGame()} />);
  await settle();
  return backend;
}

const EXISTS: TaskChoice = { kind: "exists", mod: "SkyUI" };

describe("TaskTray: prompts", () => {
  it("opens the prompt for a task waiting on a choice, once", async () => {
    const { update } = await renderTray();
    const id = freshTaskId();
    await update({ id, state: "choice", choice: EXISTS });
    expect(await screen.findByText("SkyUI is already installed")).toBeTruthy();
    await update({ id, step: "still waiting" });
    await update({ id, title: "SkyUI again" });
    expect(screen.getAllByText("SkyUI is already installed")).toHaveLength(1);
    expect(openModalCount()).toBe(1);
  });

  it.each([["Replace", "replace"], ["Keep both", "rename"]])("%s answers %j", async (button, value) => {
    const { update } = await renderTray();
    const id = freshTaskId();
    await update({ id, state: "choice", choice: EXISTS });
    fireEvent.click(await screen.findByRole("button", { name: button }));
    await waitFor(() => expect(bridgeCalls("task_answer")).toEqual([{ task_id: id, value }]));
    await waitFor(() => expect(screen.queryByText("SkyUI is already installed")).toBeNull());
  });

  it("doesn't reopen an answered prompt, but Choose… does", async () => {
    const { update } = await renderTray();
    const id = freshTaskId();
    await update({ id, state: "choice", choice: EXISTS });
    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
    await waitFor(() => expect(screen.queryByText("SkyUI is already installed")).toBeNull());
    await update({ id, step: "progress" });
    expect(screen.queryByText("SkyUI is already installed")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Choose…" }));
    expect(await screen.findByText("SkyUI is already installed")).toBeTruthy();
  });

  it("closes the prompt when the task moves on without it", async () => {
    const { update } = await renderTray();
    const id = freshTaskId();
    await update({ id, state: "choice", choice: EXISTS });
    await screen.findByText("SkyUI is already installed");
    await update({ id, state: "working", choice: null });
    expect(screen.queryByText("SkyUI is already installed")).toBeNull();
  });

  it("B asks before cancelling the install", async () => {
    const { update } = await renderTray();
    const id = freshTaskId();
    await update({ id, state: "choice", choice: EXISTS });
    pressB(await screen.findByRole("button", { name: "Replace" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel install" }));
    await waitFor(() => expect(bridgeCalls("task_cancel")).toEqual([{ task_id: id }]));
    expect(bridgeCalls("task_answer")).toEqual([]);
  });

  it("the deps prompt sends the checked ids", async () => {
    const { update } = await renderTray();
    const id = freshTaskId();
    await update({
      id, kind: "thunderstore", state: "choice", choice: {
        kind: "deps", mod: "Jotunn", packages: [
          { id: "denikson-BepInExPack_Valheim-5.4.2202", label: "BepInExPack Valheim", version: "5.4.2202", author: "denikson" },
          { id: "ValheimModding-HookGenPatcher-0.0.4", label: "HookGenPatcher", version: "0.0.4", author: "ValheimModding" },
        ],
      },
    });
    expect(await screen.findByText("Jotunn needs these mods")).toBeTruthy();
    pressA(row("HookGenPatcher"));
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await waitFor(() => expect(bridgeCalls("task_answer")).toEqual([
      { task_id: id, value: ["denikson-BepInExPack_Valheim-5.4.2202"] },
    ]));
  });

  it("the deps prompt with everything unchecked installs without them", async () => {
    const { update } = await renderTray();
    const id = freshTaskId();
    await update({
      id, state: "choice",
      choice: { kind: "deps", mod: "Jotunn", packages: [{ id: "a-b-1", label: "Dep", version: "1", author: "a" }] },
    });
    pressA(await screen.findByText("Dep"));
    fireEvent.click(screen.getByRole("button", { name: "Install without them" }));
    await waitFor(() => expect(bridgeCalls("task_answer")).toEqual([{ task_id: id, value: [] }]));
  });
});

describe("TaskTray: rows", () => {
  it("shows a done task's installed mods, then drops it", async () => {
    const { update } = await renderTray();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await update({ id: freshTaskId(), state: "done", result: { installed: ["SkyUI", "SkyUI Patch"] } });
    expect(screen.getByText("Installed SkyUI, SkyUI Patch")).toBeTruthy();
    await act(async () => void vi.advanceTimersByTime(6000));
    expect(screen.queryByText("Installed SkyUI, SkyUI Patch")).toBeNull();
  });

  it("keeps an error until dismissed", async () => {
    const { update } = await renderTray();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await update({ id: freshTaskId(), title: "Broken mod", state: "error", error: "Archive is corrupt" });
    await act(async () => void vi.advanceTimersByTime(60000));
    const error = screen.getByText("Archive is corrupt");
    fireEvent.click(within(error.closest("[data-focusable]") as HTMLElement).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Archive is corrupt")).toBeNull();
  });

  it("shows progress and Cancel calls task_cancel", async () => {
    const { update } = await renderTray();
    const id = freshTaskId();
    await update({ id, state: "working", step: "Downloading", progress: [25, 100] });
    expect(screen.getByText("25%")).toBeTruthy();
    expect(screen.getByText("Downloading")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(bridgeCalls("task_cancel")).toEqual([{ task_id: id }]));
  });

  it("marks unfinished tasks failed when the helper stops", async () => {
    const { update } = await renderTray();
    await update({ id: freshTaskId(), state: "working" });
    await emit("amethyst_event", "bridge_stopped", null);
    expect(screen.getByText("Amethyst's helper stopped.")).toBeTruthy();
  });
});
