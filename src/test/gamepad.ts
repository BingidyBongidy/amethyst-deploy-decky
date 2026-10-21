/**
 * Press controller buttons on elements rendered with the @decky/ui test double
 * (see deckyUi.tsx for how each button maps to a DOM event).
 */
import { fireEvent, screen } from "@testing-library/react";
import { GAMEPAD_KEYS } from "./deckyUi";

export const pressA = (el: Element) => fireEvent.click(el);
export const pressX = (el: Element) => fireEvent.keyDown(el, { key: GAMEPAD_KEYS.X });
export const pressY = (el: Element) => fireEvent.keyDown(el, { key: GAMEPAD_KEYS.Y });
export const pressB = (el: Element) => fireEvent.keyDown(el, { key: GAMEPAD_KEYS.B });
/** Move gamepad focus onto an element (the D-pad landing on it). */
export const focusOn = (el: Element) => fireEvent.focus(el);

/** The innermost Focusable (row, card, file) around an element. */
export function focusableOf(el: Element): HTMLElement {
  const row = el.closest<HTMLElement>("[data-focusable]");
  if (!row) throw new Error(`no Focusable around ${el.outerHTML}`);
  return row;
}

/** The Focusable row showing this text. */
export const row = (text: string | RegExp) => focusableOf(screen.getByText(text));
export const findRow = async (text: string | RegExp) => focusableOf(await screen.findByText(text));

/** Pick an option in a Dropdown (a <select> in the test double) by its label. */
export function choose(select: HTMLElement, label: string) {
  const option = Array.from((select as HTMLSelectElement).options).find((o) => o.textContent === label);
  if (!option) throw new Error(`no option "${label}"`);
  fireEvent.change(select, { target: { value: option.value } });
}

/** The Dropdown that offers an option with this label. */
export function dropdownWith(label: string): HTMLSelectElement {
  const option = screen.getByRole("option", { name: label });
  return option.closest("select") as HTMLSelectElement;
}
