/** A fake task list on the backend that tests change with task events. */
import type { Task } from "../shared";
import { emit, onBridge } from "./deckyApi";
import { makeTask } from "./fixtures";

let serial = 0;
/** A task id no other test used: TaskTray remembers prompts and dismissals per id. */
export const freshTaskId = () => `task-${++serial}`;

export function fakeTasks() {
  const tasks = new Map<string, Task>();
  onBridge("tasks", () => [...tasks.values()]);
  /** Store the task and send its "task" event, like the bridge does on every change. */
  const update = async (over: Partial<Task> & { id: string }) => {
    const t = { ...(tasks.get(over.id) ?? makeTask()), ...over };
    tasks.set(t.id, t);
    await emit("amethyst_event", "task", t);
    return t;
  };
  return { update };
}
