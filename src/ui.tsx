import { Focusable, GamepadEvent, Spinner } from "@decky/ui";
import { CSSProperties, ReactNode, useEffect, useRef, useState } from "react";
import { FaCheckSquare, FaRegSquare } from "react-icons/fa";
import { errText, toast } from "./shared";

// Shared look for every full-screen view. Add classes here, prefixed amd-.
export const CSS = `
.amd-page { padding: 48px 24px 0; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; }
.amd-header { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding-bottom: 8px; }
.amd-header .amd-pick { min-width: 220px; }
.amd-status { font-size: 12px; opacity: 0.7; padding-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.amd-tabs { flex: 1; min-height: 0; }
.amd-row { display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-radius: 4px; font-size: 14px; }
.amd-row.amd-focus { background: rgba(255,255,255,0.12); }
.amd-row.amd-sep { margin-top: 10px; font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.75; border-bottom: 1px solid rgba(255,255,255,0.15); border-radius: 0; }
.amd-row.amd-dim { opacity: 0.45; }
.amd-row.amd-grabbed { background: rgba(26,159,255,0.35); outline: 2px solid #1a9fff; }
.amd-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.amd-tag { font-size: 11px; opacity: 0.6; }
.amd-warn { font-size: 12px; color: #ffc82c; }
.amd-err { font-size: 12px; color: #ff6b6b; }
.amd-note { padding: 12px 14px; font-size: 13px; opacity: 0.85; }
.amd-bar { display: flex; gap: 12px; align-items: center; padding: 4px 0 10px; }
.amd-card { display: flex; gap: 12px; padding: 10px 14px; border-radius: 6px; align-items: center; }
.amd-card.amd-focus { background: rgba(255,255,255,0.12); }
.amd-thumb { width: 96px; height: 54px; object-fit: cover; border-radius: 4px; background: rgba(255,255,255,0.06); flex: none; }
.amd-sub { font-size: 12px; opacity: 0.7; }
.amd-scroll { overflow-y: auto; }
`;

/** Install UI: modals (prompts, FOMOD, text reader) and the task tray. */
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

const STYLE_ID = "amd-css";

/** Put the plugin's one stylesheet in the document head (idempotent). Modals render
 * outside the page, so a global sheet styles them too. */
export function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS + INSTALL_CSS;
  document.head.appendChild(el);
}

export const removeStyles = () => document.getElementById(STYLE_ID)?.remove();

/** Bytes -> "4.2 MB"; "" for 0 or unknown. */
export function formatSize(bytes: number | undefined | null): string {
  let v = Number(bytes) || 0;
  if (v <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")} ${units[i]}`;
}

/** Scroll a newly focused element into view (scroll panels don't always follow focus). */
export const scrollOnFocus = (e: { currentTarget: EventTarget }) =>
  (e.currentTarget as HTMLElement).scrollIntoView?.({ block: "nearest" });

/** Stop B from reaching the modal/page behind, and run our own handler. */
export const swallowB = (fn: () => void) => (e: GamepadEvent) => {
  e.stopPropagation();
  e.preventDefault();
  fn();
};

/**
 * Split plain text into focusable chunks so the D-pad can step through (and
 * scroll) a long text. Paragraphs over ~700 chars are cut at sentence ends.
 */
function chunks(text: string): string[] {
  const out: string[] = [];
  for (const para of (text || "").split(/\n\s*\n/)) {
    const p = para.trim();
    if (!p) continue;
    if (p.length <= 700) {
      out.push(p);
      continue;
    }
    let cur = "";
    for (const s of p.match(/[^.!?\n]+[.!?]*\s*|\n/g) ?? [p]) {
      if (cur.length + s.length > 700 && cur) {
        out.push(cur.trim());
        cur = "";
      }
      cur += s;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

/** Long text the D-pad can scroll: one Focusable per chunk, scrolled into view on focus. */
export function LongText({ text, style, empty = null }: { text: string; style?: CSSProperties; empty?: ReactNode }) {
  const parts = chunks(text);
  if (!parts.length) return <>{empty}</>;
  return (
    <Focusable flow-children="vertical" className="amd-scrollbox" style={style}>
      {parts.map((p, i) => (
        <Focusable key={i} className="amd-para" focusClassName="amd-focus" noFocusRing
          onFocus={scrollOnFocus} onActivate={() => {}}>
          {p}
        </Focusable>
      ))}
    </Focusable>
  );
}

export const Check = ({ on }: { on: boolean }) => (on ? <FaCheckSquare /> : <FaRegSquare style={{ opacity: 0.6 }} />);

export const Note = ({ children }: { children: ReactNode }) => <div className="amd-note">{children}</div>;

export const Loading = ({ text }: { text: string }) => (
  <div className="amd-note" style={{ display: "flex", gap: 8, alignItems: "center" }}>
    <Spinner style={{ height: 20 }} /> {text}
  </div>
);

/**
 * Rows loaded from the bridge with optimistic edits. `save` applies a local
 * change at once, runs the bridge call, then takes the bridge's rows as truth
 * (or puts the old rows back and shows the error).
 */
export function useRows<T>(load: (() => Promise<T[]>) | null, deps: unknown[]) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const rowsRef = useRef<T[] | null>(null);
  rowsRef.current = rows;

  useEffect(() => {
    if (!load) return;
    let live = true;
    setRows(null);
    setError("");
    load().then((r) => live && setRows(r), (e) => live && setError(errText(e)));
    return () => { live = false; };
  }, deps);

  const save = async (optimistic: T[] | null, call: () => Promise<T[]>) => {
    const before = rowsRef.current;
    if (optimistic) setRows(optimistic);
    setSaving(true);
    try {
      setRows(await call());
    } catch (e) {
      setRows(before);
      toast(errText(e));
    } finally {
      setSaving(false);
    }
  };
  return { rows, setRows, error, saving, save };
}

