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
export function ReorderList<T>(p: Props<T>) {
  const [grab, setGrab] = useState<Grab<T> | null>(null);
  useEffect(() => setGrab(null), [p.items]);

  const shown = grab ? grab.order : p.items;

  const moveTo = (g: Grab<T>, i: number): Grab<T> => {
    const from = g.order.findIndex((x) => p.keyOf(x) === g.key);
    if (from < 0 || from === i) return g;
    const order = [...g.order];
    const [it] = order.splice(from, 1);
    order.splice(i, 0, it);
    return { ...g, order };
  };

  const drop = (g: Grab<T>, item: T) => {
    const to = g.order.findIndex((x) => p.keyOf(x) === g.key);
    setGrab(null);
    if (to >= 0 && to !== g.from) p.onMove(item, to, g.order);
  };

  return (
    <Focusable flow-children="vertical" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {shown.map((item, i) => {
        const grabbed = grab?.key === p.keyOf(item);
        const cls = ["amd-row", p.rowClass?.(item) ?? "", grabbed ? "amd-grabbed" : ""].join(" ");
        return (
          <Focusable
            key={i}
            className={cls}
            focusClassName="amd-focus"
            onFocus={(e) => {
              scrollOnFocus(e);
              if (grab && !grabbed) setGrab((g) => (g ? moveTo(g, i) : g));
            }}
            onActivate={() => {
              if (grab) {
                if (grabbed) drop(grab, item);
                return;
              }
              if (!p.disabled && p.canToggle(item)) p.onToggle(item);
            }}
            onSecondaryButton={() => {
              if (grab || p.disabled || !p.canMove(item)) return;
              setGrab({ key: p.keyOf(item), from: i, order: [...p.items] });
            }}
            // Only claim B while carrying something, so B still goes back otherwise.
            onCancelButton={grab ? (e: GamepadEvent) => {
              e.stopPropagation();
              e.preventDefault();
              setGrab(null);
            } : undefined}
            onOKActionDescription={grab ? (grabbed ? "Drop here" : undefined)
              : !p.disabled && p.canToggle(item) ? p.toggleLabel(item) : undefined}
            onSecondaryActionDescription={!grab && !p.disabled && p.canMove(item) ? "Move" : undefined}
            onOptionsButton={() => {
              if (!grab && !p.disabled && p.optionLabel?.(item)) p.onOption?.(item);
            }}
            onOptionsActionDescription={!grab && !p.disabled ? p.optionLabel?.(item) || undefined : undefined}
            onCancelActionDescription={grab ? "Cancel move" : undefined}
          >
            {p.renderRow(item, { grabbed })}
          </Focusable>
        );
      })}
    </Focusable>
  );
}
