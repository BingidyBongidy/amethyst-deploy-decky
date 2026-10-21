import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskTray } from "./TaskTray";
import type { FomodOption, FomodView } from "../shared";
import { bridgeCalls, onBridge } from "../test/deckyApi";
import { makeGame } from "../test/fixtures";
import { pressA, pressX, row } from "../test/gamepad";
import { settle } from "../test/settle";
import { fakeTasks, freshTaskId } from "../test/tasks";

const option = (name: string, over: Partial<FomodOption> = {}): FomodOption => ({
  name, description: "", image: false, selected: false, type: "Optional",
  locked: false, missing: false, previous: false, ...over,
});

/** Two steps: pick a texture size, then any optional patches. */
function installer(selected: string | null): FomodView {
  return {
    title: "Cool Textures",
    steps: [
      { index: 0, name: "Texture size", groups: [{ name: "Resolution", type: "SelectExactlyOne", options: [
        option("2K", { selected: selected === "2K", description: "Sharper, needs more VRAM." }),
        option("1K", { selected: selected === "1K", type: "Recommended" }),
      ] }] },
      { index: 1, name: "Patches", groups: [{ name: "Compatibility", type: "SelectAny", options: [
        option("USSEP patch"),
      ] }] },
    ],
    errors: selected ? [] : [{ step: 0, message: "Resolution: pick one option." }],
  };
}

/** The tray with a FOMOD task waiting; the backend keeps the selection. */
async function openWizard() {
  let selected: string | null = null;
  onBridge("fomod_view", () => installer(selected));
  onBridge("fomod_toggle", (p) => {
    selected = p.name;
    return installer(selected);
  });
  onBridge("task_answer", () => ({}));
  const { update } = fakeTasks();
  render(<TaskTray game={makeGame()} />);
  await settle();
  const id = freshTaskId();
  await update({ id, title: "Cool Textures", state: "choice", choice: { kind: "fomod", title: "Cool Textures" } });
  await settle();
  screen.getByRole("heading", { name: "Texture size" });
  return id;
}

const nextButton = () => screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;

describe("FomodWizard", () => {
  it("shows the step, its groups and options", async () => {
    const id = await openWizard();
    expect(bridgeCalls("fomod_view")).toEqual([{ task_id: id }]);
    expect(screen.getByText("Cool Textures · Step 1 of 2")).toBeTruthy();
    expect(screen.getByText("Resolution")).toBeTruthy();
    expect(screen.getByText("Pick one")).toBeTruthy();
    expect(row("2K")).toBeTruthy();
    expect(row("Recommended").textContent).toContain("1K");
  });

  it("A on an option calls fomod_toggle", async () => {
    const id = await openWizard();
    pressA(row("1K"));
    await waitFor(() => expect(bridgeCalls("fomod_toggle")).toEqual([{ task_id: id, step: 0, group: 0, name: "1K" }]));
  });

  it("Next is blocked while the step has an error", async () => {
    await openWizard();
    expect(screen.getByText("Resolution: pick one option.")).toBeTruthy();
    expect(nextButton().disabled).toBe(true);
    pressA(row("2K"));
    await waitFor(() => expect(nextButton().disabled).toBe(false));
    expect(screen.queryByText("Resolution: pick one option.")).toBeNull();
    fireEvent.click(nextButton());
    expect(screen.getByRole("heading", { name: "Patches" })).toBeTruthy();
    expect(screen.getByText("Cool Textures · Step 2 of 2")).toBeTruthy();
  });

  it("Install on the last step answers \"install\"", async () => {
    const id = await openWizard();
    pressA(row("2K"));
    await waitFor(() => expect(nextButton().disabled).toBe(false));
    fireEvent.click(nextButton());
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await waitFor(() => expect(bridgeCalls("task_answer")).toEqual([{ task_id: id, value: "install" }]));
  });

  it("Back returns to the previous step", async () => {
    await openWizard();
    pressA(row("2K"));
    await waitFor(() => expect(nextButton().disabled).toBe(false));
    fireEvent.click(nextButton());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Texture size" })).toBeTruthy();
  });

  it("X on an option opens its full description", async () => {
    await openWizard();
    pressX(row("2K"));
    expect(await screen.findByRole("heading", { name: "2K" })).toBeTruthy();
    expect(screen.getAllByText("Sharper, needs more VRAM.").length).toBeGreaterThan(0);
  });
});
