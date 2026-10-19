import { DialogButton, Focusable, GamepadEvent, ModalRoot, showModal, ShowModalResult } from "@decky/ui";
import { CSSProperties, ReactNode } from "react";
import { CSS } from "../ui";

/** Styles the install UI needs on top of ui.tsx. Modals render outside the page,
 * so every modal also carries the page CSS (cheap, and robust if the page closes). */
export const INSTALL_CSS = `
.amd-modal { display: flex; flex-direction: column; gap: 8px; }
.amd-modal h2 { margin: 0; font-size: 20px; }
.amd-scrollbox { overflow-y: auto; min-height: 0; }
.amd-para { padding: 4px 8px; border-radius: 4px; white-space: pre-wrap; font-size: 13px; line-height: 1.4; }
.amd-para.amd-focus { background: rgba(255,255,255,0.08); }
.amd-badge { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 1px 6px; border-radius: 3px; background: rgba(255,255,255,0.15); flex: none; }
.amd-badge.amd-rec { background: rgba(26,159,255,0.35); }
.amd-badge.amd-req { background: rgba(255,200,44,0.35); }
.amd-btns { display: flex; gap: 10px; justify-content: flex-end; padding-top: 6px; }
.amd-btns > * { width: auto !important; min-width: 130px; }
.amd-task { display: flex; gap: 12px; align-items: center; padding: 6px 10px; border-radius: 4px; background: rgba(255,255,255,0.04); }
.amd-task .amd-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.amd-task .amd-btn { width: auto !important; min-width: 110px; flex: none; }
`;

export const ModalStyle = () => <style>{CSS + INSTALL_CSS}</style>;

export const humanSize = (n: number) => {
  if (!n || n < 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
};

/** Stop B from reaching the modal/page behind, and run our own handler. */
export const swallowB = (fn: () => void) => (e: GamepadEvent) => {
  e.stopPropagation();
  e.preventDefault();
  fn();
};

/** Long text the D-pad can scroll: one Focusable per paragraph, scrolled into view on focus. */
export function Paragraphs({ text, style }: { text: string; style?: CSSProperties }) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) return <div className="amd-sub">No text.</div>;
  return (
    <Focusable flow-children="vertical" className="amd-scrollbox" style={style}>
      {paras.map((p, i) => (
        <Focusable key={i} className="amd-para" focusClassName="amd-focus" noFocusRing
          onFocus={(e) => (e.currentTarget as HTMLElement).scrollIntoView?.({ block: "nearest" })}>
          {p}
        </Focusable>
      ))}
    </Focusable>
  );
}

function TextModal({ title, text, image, closeModal }: { title: string; text: string; image?: string; closeModal?: () => void }) {
  return (
    <ModalRoot closeModal={closeModal} bAllowFullSize>
      <ModalStyle />
      <div className="amd-modal" style={{ width: "min(900px, calc(100vw - 140px))", height: "min(560px, calc(100vh - 180px))" }}>
        <h2>{title}</h2>
        {image && <img src={image} style={{ maxWidth: "100%", maxHeight: 220, objectFit: "contain", alignSelf: "center" }} />}
        <Paragraphs text={text} style={{ flex: 1 }} />
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
