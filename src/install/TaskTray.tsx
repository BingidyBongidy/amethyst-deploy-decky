import { DialogButton, Focusable, ProgressBar } from "@decky/ui";
import { useEffect, useState } from "react";
import { Task, TabProps, bridge, errText, taskFinished, toast, useTasks } from "../shared";
import { INSTALL_CSS } from "./common";
import { openPrompt } from "./prompts";

/** How long "Installed X" / "Cancelled" stay before dropping off. Errors stay until dismissed. */
const LINGER_MS = 5000;

// Module state, so it survives the tray remounting (tab switches, page reopen).
/** Choices we've already prompted for: `${id}:${choice json}`. Each opens once. */
const prompted = new Set<string>();
/** When we first saw a task finished. */
const finishedAt = new Map<string, number>();
const dismissed = new Set<string>();
/** First-seen order: useTasks moves a task to the end on every event; we keep rows still. */
const order = new Map<string, number>();
let seq = 0;

const percent = (t: Task) => {
  const [done, total] = t.progress ?? [0, 0];
  return total > 0 ? Math.min(100, Math.max(0, (done / total) * 100)) : null;
};

function statusLine(t: Task) {
  switch (t.state) {
    case "done": {
      const names = t.result?.installed ?? [];
      return names.length ? `Installed ${names.join(", ")}` : "Installed";
    }
    case "error": return t.error || "Failed";
    case "cancelled": return "Cancelled";
    case "choice": return "Waiting for your choice";
    default: return t.step || "Working…";
  }
}

/** Active install/download tasks with progress, and the prompts for tasks
 * waiting on a choice (FOMOD, BAIN, already exists, dependencies). */
export function TaskTray({ game }: { game?: TabProps["game"]; profile?: string }) {
  const tasks = useTasks();
  const [now, setNow] = useState(Date.now());

  // Open each new choice once, automatically.
  useEffect(() => {
    for (const t of tasks) {
      if (t.state !== "choice" || !t.choice) continue;
      const key = `${t.id}:${JSON.stringify(t.choice)}`;
      if (prompted.has(key)) continue;
      prompted.add(key);
      openPrompt(t);
    }
  }, [tasks]);

  for (const t of tasks) {
    if (!order.has(t.id)) order.set(t.id, seq++);
    if (taskFinished(t) && !finishedAt.has(t.id)) finishedAt.set(t.id, Date.now());
  }
  const shown = tasks
    .filter((t) => !dismissed.has(t.id))
    .filter((t) => !taskFinished(t) || t.state === "error" || now - (finishedAt.get(t.id) ?? now) < LINGER_MS)
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  // Tick while something is lingering, so it drops off on time.
  const lingering = shown.some((t) => t.state === "done" || t.state === "cancelled");
  useEffect(() => {
    if (!lingering) return;
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, [lingering]);

  if (!shown.length) return null;

  const dismiss = (t: Task) => {
    dismissed.add(t.id);
    setNow(Date.now());
  };
  const cancel = async (t: Task) => {
    try {
      await bridge<Task>("task_cancel", { task_id: t.id });
    } catch (e) {
      toast(errText(e));
    }
  };

  return (
    <Focusable flow-children="vertical" className="amd-scrollbox"
      style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 170, paddingBottom: 8 }}>
      <style>{INSTALL_CSS}</style>
      {shown.map((t) => {
        const pct = percent(t);
        const other = game && t.game !== game.name ? `${t.game} · ${t.profile}` : "";
        const cls = t.state === "error" ? "amd-err" : "amd-sub";
        return (
          <Focusable key={t.id} flow-children="horizontal" className="amd-task"
            onFocus={(e) => (e.currentTarget as HTMLElement).scrollIntoView?.({ block: "nearest" })}>
            <div className="amd-main">
              <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span className="amd-name" style={{ fontWeight: 600 }}>{t.title}</span>
                {other && <span className="amd-tag">{other}</span>}
                {pct !== null && t.state === "working" && <span className="amd-tag">{Math.round(pct)}%</span>}
              </div>
              <div className={cls} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {statusLine(t)}
              </div>
              {t.state === "working" && <ProgressBar nProgress={pct ?? 0} indeterminate={pct === null} nTransitionSec={0.25} />}
            </div>
            {t.state === "choice" && (
              <DialogButton className="amd-btn" onClick={() => openPrompt(t)}>
                Choose…
              </DialogButton>
            )}
            {!taskFinished(t) && (
              <DialogButton className="amd-btn" onClick={() => cancel(t)}>
                Cancel
              </DialogButton>
            )}
            {taskFinished(t) && (
              <DialogButton className="amd-btn" onClick={() => dismiss(t)}>
                Dismiss
              </DialogButton>
            )}
          </Focusable>
        );
      })}
    </Focusable>
  );
}
