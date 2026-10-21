import { DialogButton, Focusable, ModalRoot, showModal, ShowModalResult } from "@decky/ui";
import { ReactNode, useState } from "react";
import { Check, LongText, Styles, scrollOnFocus } from "../ui";

function TextModal({ title, text, image, closeModal }: { title: string; text: string; image?: string; closeModal?: () => void }) {
  return (
    <ModalRoot closeModal={closeModal} bAllowFullSize>
      <Styles />
      <div className="amd-modal amd-modal-large">
        <h2>{title}</h2>
        {image && <img src={image} className="amd-text-image" />}
        <LongText text={text} className="amd-fill" empty={<div className="amd-sub">No text.</div>} />
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
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial()));
  const flip = (key: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    return next;
  });
  return [selected, flip] as const;
}

export type CheckItem = { key: string; label: string; tag?: ReactNode };

/** Scrollable list of checkbox rows; A toggles the focused row. */
export function CheckList({ items, selected, flip, disabled }: {
  items: CheckItem[]; selected: Set<string>; flip: (key: string) => void; disabled?: boolean;
}) {
  return (
    <Focusable flow-children="vertical" className="amd-scrollbox amd-checklist">
      {items.map((item) => (
        <Focusable key={item.key} className="amd-row" focusClassName="amd-focus"
          onFocus={scrollOnFocus}
          onActivate={() => !disabled && flip(item.key)}
          onOKActionDescription={selected.has(item.key) ? "Uncheck" : "Check"}>
          <Check on={selected.has(item.key)} />
          <span className="amd-name">{item.label}</span>
          {item.tag ? <span className="amd-tag">{item.tag}</span> : null}
        </Focusable>
      ))}
    </Focusable>
  );
}
