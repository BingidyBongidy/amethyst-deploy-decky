import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Focusable } from "@decky/ui";
import { ReorderList } from "./ReorderList";
import { focusOn, pressA, pressB, pressX, pressY, row } from "./test/gamepad";

type Item = { name: string; fixed?: boolean };
const ITEMS: Item[] = [{ name: "Alpha" }, { name: "Bravo" }, { name: "Charlie" }, { name: "Delta", fixed: true }];

function renderList(over: Partial<Parameters<typeof ReorderList<Item>>[0]> = {}) {
  const p = {
    onToggle: vi.fn(), onMove: vi.fn(), onOption: vi.fn(), onBack: vi.fn(),
  };
  render(
    // A parent that handles B, like the page behind the list.
    <Focusable onCancelButton={p.onBack}>
      <ReorderList<Item>
        items={ITEMS}
        keyOf={(i) => i.name}
        renderRow={(i) => <span>{i.name}</span>}
        canToggle={(i) => !i.fixed}
        canMove={(i) => !i.fixed}
        toggleLabel={() => "Toggle"}
        onToggle={p.onToggle}
        onMove={p.onMove}
        optionLabel={(i) => (i.name === "Bravo" ? undefined : "Uninstall")}
        onOption={p.onOption}
        {...over}
      />
    </Focusable>,
  );
  return p;
}

/** Row names top to bottom, as shown. */
const shownOrder = () => screen.getAllByText(/^(Alpha|Bravo|Charlie|Delta)$/).map((e) => e.textContent);

describe("ReorderList", () => {
  it("A toggles a row", () => {
    const p = renderList();
    pressA(row("Bravo"));
    expect(p.onToggle).toHaveBeenCalledWith(ITEMS[1]);
  });

  it("A does nothing on a row that can't toggle", () => {
    const p = renderList();
    pressA(row("Delta"));
    expect(p.onToggle).not.toHaveBeenCalled();
  });

  it("X picks a row up, focus carries it, A drops it", () => {
    const p = renderList();
    const rows = () => screen.getAllByText(/^(Alpha|Bravo|Charlie|Delta)$/);
    pressX(row("Alpha"));
    focusOn(rows()[1]);
    focusOn(rows()[2]);
    expect(shownOrder()).toEqual(["Bravo", "Charlie", "Alpha", "Delta"]);
    expect(p.onMove).not.toHaveBeenCalled();

    pressA(row("Alpha"));
    expect(p.onMove).toHaveBeenCalledTimes(1);
    expect(p.onMove).toHaveBeenCalledWith(ITEMS[0], 2, [ITEMS[1], ITEMS[2], ITEMS[0], ITEMS[3]]);
    expect(p.onToggle).not.toHaveBeenCalled();
  });

  it("A on another row while carrying does nothing", () => {
    const p = renderList();
    pressX(row("Alpha"));
    pressA(row("Charlie"));
    expect(p.onToggle).not.toHaveBeenCalled();
    expect(p.onMove).not.toHaveBeenCalled();
  });

  it("dropping where it started doesn't call onMove", () => {
    const p = renderList();
    pressX(row("Bravo"));
    pressA(row("Bravo"));
    expect(p.onMove).not.toHaveBeenCalled();
  });

  it("B cancels a move without going back", () => {
    const p = renderList();
    pressX(row("Alpha"));
    focusOn(row("Charlie"));
    expect(shownOrder()).toEqual(["Bravo", "Charlie", "Alpha", "Delta"]);
    pressB(row("Alpha"));
    expect(shownOrder()).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
    expect(p.onBack).not.toHaveBeenCalled();
    expect(p.onMove).not.toHaveBeenCalled();
  });

  it("B goes back when nothing is carried", () => {
    const p = renderList();
    pressB(row("Alpha"));
    expect(p.onBack).toHaveBeenCalledTimes(1);
  });

  it("X does nothing on a row that can't move", () => {
    const p = renderList();
    pressX(row("Delta"));
    focusOn(row("Alpha"));
    expect(shownOrder()).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
    pressA(row("Alpha"));
    expect(p.onToggle).toHaveBeenCalledWith(ITEMS[0]);
  });

  it("Y calls onOption only when optionLabel gives a label", () => {
    const p = renderList();
    pressY(row("Alpha"));
    expect(p.onOption).toHaveBeenCalledWith(ITEMS[0]);
    pressY(row("Bravo"));
    expect(p.onOption).toHaveBeenCalledTimes(1);
  });

  it("disabled blocks toggles, moves and options", () => {
    const p = renderList({ disabled: true });
    pressA(row("Alpha"));
    pressY(row("Alpha"));
    pressX(row("Alpha"));
    focusOn(row("Charlie"));
    pressA(row("Charlie"));
    expect(shownOrder()).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
    expect(p.onToggle).not.toHaveBeenCalled();
    expect(p.onOption).not.toHaveBeenCalled();
    expect(p.onMove).not.toHaveBeenCalled();
  });
});
