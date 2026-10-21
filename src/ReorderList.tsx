import { Focusable, GamepadEvent } from "@decky/ui";
import { ReactNode, useEffect, useState } from "react";
import { scrollOnFocus } from "./ui";

type Props<T> = {
  items: T[];
  keyOf: (item: T) => string;
  renderRow: (item: T, state: { grabbed: boolean }) => ReactNode;
  rowClass?: (item: T) => string;
  canToggle: (item: T) => boolean;
  canMove: (item: T) => boolean;
  toggleLabel: (item: T) => string;
  onToggle: (item: T) => void;
  /** Called on drop with the item, its new index and the full new order. */
  onMove: (item: T, toIndex: number, order: T[]) => void;
  /** Blocks toggles and moves (a save or a deploy is in flight). Navigation still works. */
  disabled?: boolean;
  /** Y button on a row (e.g. Uninstall); label "" or undefined = no action for that row. */
  optionLabel?: (item: T) => string | undefined;
  onOption?: (item: T) => void;
};

type Grab<T> = { key: string; from: number; order: T[] };

/**
 * A vertical list where A toggles a row, X picks it up, the D-pad carries it and
 * A drops it (B cancels). Rows are keyed by position, not by item: Steam's own
 * D-pad navigation moves focus to the next row node, and we render the grabbed
 * item into whichever row has focus. That avoids moving a focused DOM node,
 * which would drop gamepad focus.
 */
export function ReorderList<T>(props: Props<T>) {
  const [grab, setGrab] = useState<Grab<T> | null>(null);
  useEffect(() => setGrab(null), [props.items]);

  const shown = grab ? grab.order : props.items;
  const idle = !grab && !props.disabled;

  const moveTo = (current: Grab<T>, index: number): Grab<T> => {
    const from = current.order.findIndex((x) => props.keyOf(x) === current.key);
    if (from < 0 || from === index) return current;
    const order = [...current.order];
    const [moved] = order.splice(from, 1);
    order.splice(index, 0, moved);
    return { ...current, order };
  };

  const drop = (current: Grab<T>, item: T) => {
    const to = current.order.findIndex((x) => props.keyOf(x) === current.key);
    setGrab(null);
    if (to >= 0 && to !== current.from) props.onMove(item, to, current.order);
  };

  /** A: drop the carried row here, or toggle this one. */
  const activate = (item: T, grabbed: boolean) => {
    if (grab) {
      if (grabbed) drop(grab, item);
      return;
    }
    if (!props.disabled && props.canToggle(item)) props.onToggle(item);
  };

  /** X: pick the row up. */
  const pickUp = (item: T, index: number) => {
    if (grab || props.disabled || !props.canMove(item)) return;
    setGrab({ key: props.keyOf(item), from: index, order: [...props.items] });
  };

  /** B while carrying: put it back. */
  const cancelMove = (e: GamepadEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setGrab(null);
  };

  const okLabel = (item: T, grabbed: boolean) => {
    if (grab) return grabbed ? "Drop here" : undefined;
    return !props.disabled && props.canToggle(item) ? props.toggleLabel(item) : undefined;
  };

  return (
    <Focusable flow-children="vertical" className="amd-list">
      {shown.map((item, i) => {
        const grabbed = grab?.key === props.keyOf(item);
        const className = ["amd-row", props.rowClass?.(item) ?? "", grabbed ? "amd-grabbed" : ""].join(" ");
        return (
          <Focusable
            key={i}
            className={className}
            focusClassName="amd-focus"
            onFocus={(e) => {
              scrollOnFocus(e);
              if (grab && !grabbed) setGrab((current) => (current ? moveTo(current, i) : current));
            }}
            onActivate={() => activate(item, grabbed)}
            onSecondaryButton={() => pickUp(item, i)}
            // Only claim B while carrying something, so B still goes back otherwise.
            onCancelButton={grab ? cancelMove : undefined}
            onOKActionDescription={okLabel(item, grabbed)}
            onSecondaryActionDescription={idle && props.canMove(item) ? "Move" : undefined}
            onOptionsButton={() => {
              if (idle && props.optionLabel?.(item)) props.onOption?.(item);
            }}
            onOptionsActionDescription={idle ? props.optionLabel?.(item) || undefined : undefined}
            onCancelActionDescription={grab ? "Cancel move" : undefined}
          >
            {props.renderRow(item, { grabbed })}
          </Focusable>
        );
      })}
    </Focusable>
  );
}
