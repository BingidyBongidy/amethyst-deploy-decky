import { DialogButton, Focusable, ProgressBar } from "@decky/ui";
import { useEffect, useState } from "react";
import { scrollOnFocus } from "../ui";
import { Task, TabProps, bridge, errText, taskFinished, toast, useTasks } from "../shared";
import { openPrompt } from "./prompts";

/** How long "Installed X" / "Cancelled" stay before dropping off. Errors stay until dismissed. */
const LINGER_MS = 5000;

// Module state, so it survives the tray remounting (tab switches, page reopen).
/** Choices we've already prompted for: `${id}:${choice kind}`. Each opens once. */
const prompted = new Set<string>();
/** When we first saw a task finished. */
const finishedAt = new Map<string, number>();
const dismissed = new Set<string>();

const percent = (task: Task) => {
  const [done, total] = task.progress ?? [0, 0];
  return total > 0 ? Math.min(100, Math.max(0, (done / total) * 100)) : null;
};

function statusLine(task: Task) {
  switch (task.state) {
    case "done": {
      const names = task.result?.installed ?? [];
      return names.length ? `Installed ${names.join(", ")}` : "Installed";
    }
    case "error": return task.error || "Failed";
    case "cancelled": return "Cancelled";
    case "choice": return "Waiting for your choice";
    default: return task.step || "Working…";
  }
}

/** Active install/download tasks with progress, and the prompts for tasks
 * waiting on a choice (FOMOD, BAIN, already exists, dependencies). */
export function TaskTray({ game }: { game?: TabProps["game"] }) {
  const tasks = useTasks();
  const [now, setNow] = useState(Date.now());

  // Open each new choice once, automatically.
  useEffect(() => {
    for (const task of tasks) {
      if (task.state !== "choice" || !task.choice) continue;
      const key = task.id + ":" + task.choice.kind;
      if (prompted.has(key)) continue;
      prompted.add(key);
      openPrompt(task);
    }
  }, [tasks]);

  for (const task of tasks) {
    if (taskFinished(task) && !finishedAt.has(task.id)) finishedAt.set(task.id, Date.now());
  }
  const shown = tasks
    .filter((task) => !dismissed.has(task.id))
    .filter((task) => !taskFinished(task) || task.state === "error" || now - (finishedAt.get(task.id) ?? now) < LINGER_MS);

  // Tick while something is lingering, so it drops off on time.
  const lingering = shown.some((task) => task.state === "done" || task.state === "cancelled");
  useEffect(() => {
    if (!lingering) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [lingering]);

  if (!shown.length) return null;

  const dismiss = (task: Task) => {
    dismissed.add(task.id);
    setNow(Date.now());
  };

  return (
    <Focusable flow-children="vertical" className="amd-scrollbox amd-tray">
      {shown.map((task) => (
        <TaskRow key={task.id} task={task} currentGame={game?.name} onDismiss={() => dismiss(task)} />
      ))}
    </Focusable>
  );
}

const cancelTask = async (task: Task) => {
  try {
    await bridge<Task>("task_cancel", { task_id: task.id });
  } catch (e) {
    toast(errText(e));
  }
};

function TaskRow({ task, currentGame, onDismiss }: { task: Task; currentGame?: string; onDismiss: () => void }) {
  const pct = percent(task);
  // Name the game and profile when the task is for another game than the page shows.
  const otherGame = currentGame && task.game !== currentGame ? `${task.game} · ${task.profile}` : "";
  const finished = taskFinished(task);
  return (
    <Focusable flow-children="horizontal" className="amd-task" onFocus={scrollOnFocus}>
      <div className="amd-main">
        <div className="amd-title-row">
          <span className="amd-name amd-task-title">{task.title}</span>
          {otherGame && <span className="amd-tag">{otherGame}</span>}
          {pct !== null && task.state === "working" && <span className="amd-tag">{Math.round(pct)}%</span>}
        </div>
        <div className={`${task.state === "error" ? "amd-err" : "amd-sub"} amd-ellipsis`}>
          {statusLine(task)}
        </div>
        {task.state === "working" && <ProgressBar nProgress={pct ?? 0} indeterminate={pct === null} nTransitionSec={0.25} />}
      </div>
      {task.state === "choice" && (
        <DialogButton className="amd-btn" onClick={() => openPrompt(task)}>
          Choose…
        </DialogButton>
      )}
      {!finished && (
        <DialogButton className="amd-btn" onClick={() => cancelTask(task)}>
          Cancel
        </DialogButton>
      )}
      {finished && (
        <DialogButton className="amd-btn" onClick={onDismiss}>
          Dismiss
        </DialogButton>
      )}
    </Focusable>
  );
}
