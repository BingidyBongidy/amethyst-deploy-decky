import { DialogButton, Focusable, ModalRoot, showModal, ShowModalResult } from "@decky/ui";
import { ReactNode, useState } from "react";
import { Check, LongText, ensureStyles, scrollOnFocus } from "../ui";

function TextModal({ title, text, image, closeModal }: { title: string; text: string; image?: string; closeModal?: () => void }) {
  ensureStyles();
  return (
    <ModalRoot closeModal={closeModal} bAllowFullSize>
      <div className="amd-modal" style={{ width: "min(900px, calc(100vw - 140px))", height: "min(560px, calc(100vh - 180px))" }}>
        <h2>{title}</h2>
        {image && <img src={image} style={{ maxWidth: "100%", maxHeight: 220, objectFit: "contain", alignSelf: "center" }} />}
        <LongText text={text} style={{ flex: 1 }} empty={<div className="amd-sub">No text.</div>} />
        <Focusable className="amd-btns" flow-children="horizontal">
          <DialogButton onClick={() => closeModal?.()}>Close</DialogButton>
        </Focusable>
      </div>
    </ModalRoot>
  );
}

/** Full-text reader (readme, option description). B or Close goes back. */
export const showText = (title: string, text: string, image?: string): ShowModalResult =>
  showModal(<TextModal title={title} text={text} image={image} />);

export const Buttons = ({ children }: { children: ReactNode }) => (
  <Focusable className="amd-btns" flow-children="horizontal">{children}</Focusable>
);

/** A set of checked keys with a toggle. */
export function useToggleSet(initial: () => Iterable<string>) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(initial()));
  const flip = (k: string) => setSel((s) => {
    const c = new Set(s);
    if (c.has(k)) c.delete(k); else c.add(k);
    return c;
  });
  return [sel, flip] as const;
}

export type CheckItem = { key: string; label: string; tag?: ReactNode };

/** Scrollable list of checkbox rows; A toggles the focused row. */
export function CheckList({ items, sel, flip, disabled }: {
  items: CheckItem[]; sel: Set<string>; flip: (key: string) => void; disabled?: boolean;
}) {
  return (
    <Focusable flow-children="vertical" className="amd-scrollbox" style={{ maxHeight: "calc(100vh - 330px)" }}>
      {items.map((it) => (
        <Focusable key={it.key} className="amd-row" focusClassName="amd-focus"
          onFocus={scrollOnFocus}
          onActivate={() => !disabled && flip(it.key)}
          onOKActionDescription={sel.has(it.key) ? "Uncheck" : "Check"}>
          <Check on={sel.has(it.key)} />
          <span className="amd-name">{it.label}</span>
          {it.tag ? <span className="amd-tag">{it.tag}</span> : null}
        </Focusable>
      ))}
    </Focusable>
  );
}
