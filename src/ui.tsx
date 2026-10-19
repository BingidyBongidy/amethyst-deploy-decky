import { Spinner } from "@decky/ui";
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
.amd-note { padding: 12px 14px; font-size: 13px; opacity: 0.85; }
.amd-bar { display: flex; gap: 12px; align-items: center; padding: 4px 0 10px; }
.amd-card { display: flex; gap: 12px; padding: 10px 14px; border-radius: 6px; align-items: center; }
.amd-card.amd-focus { background: rgba(255,255,255,0.12); }
.amd-thumb { width: 96px; height: 54px; object-fit: cover; border-radius: 4px; background: rgba(255,255,255,0.06); flex: none; }
.amd-sub { font-size: 12px; opacity: 0.7; }
.amd-scroll { overflow-y: auto; }
`;

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

