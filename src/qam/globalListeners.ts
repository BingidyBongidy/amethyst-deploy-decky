import { addEventListener, removeEventListener } from "@decky/api";
import { JobStatus, Task, runApp, takePendingLaunch, toast } from "../shared";
import { clearGamesCache, openFullUI } from "./useQamGames";

function finishedJobLabel(status: JobStatus): string {
  switch (status.action) {
    case "install": return "Amethyst installed";
    case "update": return "Amethyst updated";
    case "restore": return `${status.game}: restored`;
    default: return `${status.game} / ${status.profile}`;
  }
}

/** A deploy/restore/install job ended: say so, and launch the game for Deploy & Play. */
function onJobDone(status: JobStatus) {
  const label = finishedJobLabel(status);
  toast(status.ok ? label : `${label} - open the plugin for the log`,
        status.ok ? "Amethyst: done" : "Amethyst: failed");
  if (status.ok) clearGamesCache(); // deploy state changed; rescan next open
  const launch = takePendingLaunch();
  if (status.ok && launch) runApp(launch);
}

/**
 * Installs keep running when the page is closed: say when one finishes or
 * needs an answer (the prompt opens again in the full-screen page).
 */
function taskToaster() {
  const asked = new Set<string>();
  return (task: Task) => {
    if (task.state === "done") {
      toast(`Installed ${(task.result?.installed ?? [task.title]).join(", ")}`);
    } else if (task.state === "error") {
      toast(`Install failed: ${task.title}: ${task.error || "Failed"}`);
    } else if (task.state === "choice" && !asked.has(task.id)) {
      asked.add(task.id);
      toast(`${task.title}: choose options in Amethyst`, "Amethyst needs you", openFullUI);
    }
  };
}

/**
 * Listeners that live as long as the plugin, so finish-up work happens even
 * when the QAM panel and the page are closed. Returns the function that removes them.
 */
export function addGlobalListeners(): () => void {
  const done = addEventListener<[JobStatus]>("amethyst_done", onJobDone);
  const toastTask = taskToaster();
  const onEvent = addEventListener<[string, any]>("amethyst_event", (event, data) => {
    if (event === "nexus_login" && data) {
      // Opening Steam's browser leaves the plugin page, so say it here.
      toast(data.logged_in ? `Logged in to Nexus Mods as ${data.name ?? "you"}` : `Nexus login failed: ${data.error ?? ""}`);
      return;
    }
    if (event === "task" && data) toastTask(data as Task);
  });
  return () => {
    removeEventListener("amethyst_done", done);
    removeEventListener("amethyst_event", onEvent);
  };
}
