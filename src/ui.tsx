import { DialogButton, Focusable, GamepadEvent, Spinner } from "@decky/ui";
import { ReactNode, useEffect, useRef, useState } from "react";
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
.amd-ok { color: #5ba32b; opacity: 1; }
.amd-note { padding: 12px 14px; font-size: 13px; opacity: 0.85; }
.amd-loading { display: flex; gap: 8px; align-items: center; }
.amd-bar { display: flex; gap: 12px; align-items: center; padding: 4px 0 10px; }
.amd-card { display: flex; gap: 12px; padding: 10px 14px; border-radius: 6px; align-items: center; }
.amd-card.amd-focus { background: rgba(255,255,255,0.12); }
.amd-card.amd-unavailable { opacity: 0.75; }
.amd-thumb { width: 96px; height: 54px; object-fit: cover; border-radius: 4px; background: rgba(255,255,255,0.06); flex: none; }
.amd-thumb.amd-thumb-large { width: 256px; height: 144px; }
.amd-sub { font-size: 12px; opacity: 0.7; }
.amd-scroll { overflow-y: auto; }

/* Layout */
.amd-stack { display: flex; flex-direction: column; }
.amd-list { display: flex; flex-direction: column; gap: 2px; }
.amd-hstack { display: flex; gap: 10px; }
.amd-gap-4 { gap: 4px; }
.amd-gap-8 { gap: 8px; }
.amd-gap-10 { gap: 10px; }
.amd-section { display: flex; flex-direction: column; gap: 10px; padding: 8px 14px; }
.amd-grow { flex: 1; min-width: 0; }
.amd-fill { flex: 1; }
.amd-fill-height { flex: 1; min-height: 0; }
.amd-fixed { flex: none; }
.amd-wrap { flex-wrap: wrap; }
.amd-align-start { align-items: flex-start; }
.amd-self-start { align-self: flex-start; }
.amd-pad { padding: 8px 14px; }
.amd-inset { padding: 4px 14px 8px; }
.amd-indent { padding-left: 14px; }
.amd-space-above { padding-top: 6px; }
.amd-gap-above { margin-top: 12px; }
.amd-narrow { max-width: 720px; }

/* Text */
.amd-title { font-size: 16px; font-weight: 600; }
.amd-title-medium { font-size: 18px; font-weight: 600; }
.amd-title-large { font-size: 20px; font-weight: 600; }
.amd-bold { font-weight: 700; }
.amd-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.amd-wrap-text { white-space: normal; }
.amd-break-all { word-break: break-all; }
.amd-prose { white-space: normal; font-size: 14px; line-height: 1.5; }
.amd-callout { padding: 4px 14px 10px; white-space: normal; line-height: 1.5; }
.amd-error-message { flex: 1; white-space: normal; font-size: 13px; }
.amd-warn-line { padding: 0 14px 6px; }
.amd-bar-text { padding-bottom: 0; white-space: normal; }
.amd-faint { opacity: 0.6; }
.amd-icon { opacity: 0.7; }

/* Buttons: Steam's DialogButton is full width unless told otherwise. */
.amd-button-auto { width: auto !important; }
.amd-retry { align-self: flex-start; margin-left: 14px; }
.amd-load-more { align-self: center; margin: 8px 0 16px; }
.amd-min-100 { min-width: 100px !important; }
.amd-min-110 { min-width: 110px !important; }
.amd-min-120 { min-width: 120px !important; }
.amd-min-140 { min-width: 140px !important; }
.amd-min-160 { min-width: 160px !important; }
.amd-min-180 { min-width: 180px !important; }
.amd-min-200 { min-width: 200px !important; }
.amd-min-220 { min-width: 220px !important; }
.amd-min-240 { min-width: 240px !important; }
.amd-min-260 { min-width: 260px !important; }
.amd-min-280 { min-width: 280px !important; }

/* Get mods */
.amd-full-row { flex-basis: 100%; padding-left: 2px; }
.amd-search-bar { padding-bottom: 2px; }
.amd-search-hint { padding: 0 0 8px 2px; }
.amd-card-title { font-size: 15px; }
.amd-card-stats { white-space: nowrap; text-align: right; display: flex; flex-direction: column; gap: 2px; }
.amd-details-header { display: flex; gap: 16px; padding: 4px 14px 8px; align-items: flex-start; }
.amd-summary { font-size: 14px; padding-top: 4px; }
.amd-title-row { display: flex; gap: 8px; align-items: baseline; }
.amd-file-description { white-space: pre-wrap; padding-top: 2px; }
.amd-text-block { padding: 0 6px; }
.amd-steps { margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.6; }

/* Quick Access panel */
.amd-qam-text { font-size: 13px; }
.amd-qam-status { font-size: 12px; opacity: 0.7; }
.amd-qam-log { font-family: monospace; font-size: 10px; white-space: pre-wrap; word-break: break-word; max-height: 160px; overflow-y: auto; opacity: 0.85; }
`;

/** Install UI: modals (prompts, FOMOD, text reader, folder picker) and the task tray. */
export const INSTALL_CSS = `
.amd-modal { display: flex; flex-direction: column; gap: 8px; }
.amd-modal h2 { margin: 0; font-size: 20px; }
.amd-modal-small { width: min(640px, calc(100vw - 140px)); }
.amd-modal-medium { width: min(760px, calc(100vw - 140px)); }
.amd-modal-large { width: min(900px, calc(100vw - 140px)); height: min(560px, calc(100vh - 180px)); }
.amd-modal-fomod { width: min(1140px, calc(100vw - 100px)); height: min(640px, calc(100vh - 140px)); }
.amd-modal-title { font-size: 20px; font-weight: 600; padding-bottom: 8px; }
.amd-modal-intro { padding-bottom: 12px; }
.amd-scrollbox { overflow-y: auto; min-height: 0; }
.amd-para { padding: 4px 8px; border-radius: 4px; white-space: pre-wrap; font-size: 13px; line-height: 1.4; }
.amd-para.amd-focus { background: rgba(255,255,255,0.08); }
.amd-text-image { max-width: 100%; max-height: 220px; object-fit: contain; align-self: center; }
.amd-checklist { max-height: calc(100vh - 330px); }
.amd-empty { padding: 8px; }
.amd-badge { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 1px 6px; border-radius: 3px; background: rgba(255,255,255,0.15); flex: none; }
.amd-badge.amd-rec { background: rgba(26,159,255,0.35); }
.amd-badge.amd-req { background: rgba(255,200,44,0.35); }
.amd-btns { display: flex; gap: 10px; justify-content: flex-end; padding-top: 6px; }
.amd-btns > * { width: auto !important; min-width: 130px; }
.amd-tray { display: flex; flex-direction: column; gap: 4px; max-height: 170px; padding-bottom: 8px; }
.amd-task { display: flex; gap: 12px; align-items: center; padding: 6px 10px; border-radius: 4px; background: rgba(255,255,255,0.04); }
.amd-task .amd-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.amd-task .amd-btn { width: auto !important; min-width: 110px; flex: none; }
.amd-task-title { font-weight: 600; }
.amd-step-header { display: flex; align-items: baseline; gap: 12px; }
.amd-fomod-columns { display: flex; gap: 16px; flex: 1; min-height: 0; }
.amd-fomod-options { flex: 1 1 58%; }
.amd-fomod-group { padding-bottom: 10px; }
.amd-fomod-group > .amd-sep { margin-top: 0; }
.amd-fomod-group + .amd-fomod-group > .amd-sep { margin-top: 6px; }
.amd-hint-tag { text-transform: none; letter-spacing: 0; }
.amd-fomod-pane { flex: 1 1 42%; min-width: 0; display: flex; flex-direction: column; gap: 8px; overflow: hidden; background: rgba(255,255,255,0.04); border-radius: 6px; padding: 12px; }
.amd-fomod-image { max-width: 100%; max-height: 240px; object-fit: contain; align-self: center; border-radius: 4px; }
.amd-fomod-description { font-size: 13px; line-height: 1.4; white-space: pre-wrap; overflow: hidden; flex: 1; min-height: 0; -webkit-mask-image: linear-gradient(to bottom, black 85%, transparent); }
`;

/**
 * Render inside every full-screen view, every modal and the Quick Access panel.
 * Decky runs plugin code in Steam's shared JS context, but those render into
 * other windows, so a <style> added to our own document.head never reaches them.
 */
export const Styles = () => <style>{CSS + INSTALL_CSS}</style>;

/** Bytes -> "4.2 MB"; "" for 0 or unknown. */
export function formatSize(bytes: number | undefined | null): string {
  let value = Number(bytes) || 0;
  if (value <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${sizeNumber(value, unit)} ${units[unit]}`;
}

/** Whole bytes as is; 100 and up rounded; otherwise one decimal, without a trailing ".0". */
function sizeNumber(value: number, unit: number): string {
  if (unit === 0) return String(value);
  if (value >= 100) return String(Math.round(value));
  return value.toFixed(1).replace(/\.0$/, "");
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
const CHUNK_CHARS = 700;

function chunks(text: string): string[] {
  const out: string[] = [];
  for (const rawParagraph of (text || "").split(/\n\s*\n/)) {
    const paragraph = rawParagraph.trim();
    if (!paragraph) continue;
    if (paragraph.length <= CHUNK_CHARS) {
      out.push(paragraph);
      continue;
    }
    out.push(...splitAtSentences(paragraph));
  }
  return out;
}

/** Cut a long paragraph into pieces of about CHUNK_CHARS, at sentence ends. */
function splitAtSentences(paragraph: string): string[] {
  const out: string[] = [];
  let current = "";
  for (const sentence of paragraph.match(/[^.!?\n]+[.!?]*\s*|\n/g) ?? [paragraph]) {
    if (current.length + sentence.length > CHUNK_CHARS && current) {
      out.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** Long text the D-pad can scroll: one Focusable per chunk, scrolled into view on focus. */
export function LongText({ text, className = "", empty = null }: { text: string; className?: string; empty?: ReactNode }) {
  const parts = chunks(text);
  if (!parts.length) return <>{empty}</>;
  return (
    <Focusable flow-children="vertical" className={`amd-scrollbox ${className}`}>
      {parts.map((part, i) => (
        <Focusable key={i} className="amd-para" focusClassName="amd-focus" noFocusRing
          onFocus={scrollOnFocus} onActivate={() => {}}>
          {part}
        </Focusable>
      ))}
    </Focusable>
  );
}

export const Check = ({ on }: { on: boolean }) => (on ? <FaCheckSquare /> : <FaRegSquare className="amd-faint" />);

export const Note = ({ children }: { children: ReactNode }) => <div className="amd-note">{children}</div>;

/** A spinner and a line of text. */
export const SpinnerLine = ({ text, className = "" }: { text: string; className?: string }) => (
  <div className={`amd-loading ${className}`}>
    <Spinner style={{ height: 20 }} /> {text}
  </div>
);

export const Loading = ({ text }: { text: string }) => <SpinnerLine className="amd-note" text={text} />;

/** A load error with a Retry button under it. */
export const RetryNote = ({ error, onRetry }: { error: string; onRetry: () => void }) => (
  <Focusable flow-children="vertical">
    <Note>{error}</Note>
    <DialogButton className="amd-button-auto amd-retry" onClick={onRetry}>Retry</DialogButton>
  </Focusable>
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

  // Reload when a dependency's value changes. `load` is a fresh closure every
  // render, so it's read through a ref rather than listed as a dependency.
  const loadRef = useRef(load);
  loadRef.current = load;
  const depsKey = JSON.stringify(deps);

  useEffect(() => {
    const loadRows = loadRef.current;
    if (!loadRows) return;
    let live = true;
    setRows(null);
    setError("");
    loadRows().then((loaded) => live && setRows(loaded), (e) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [depsKey]);

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

