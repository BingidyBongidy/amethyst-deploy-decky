import { ConfirmModal, DialogButton, Focusable, ModalRoot, showModal, ShowModalResult } from "@decky/ui";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Styles, swallowB } from "../ui";
import { Task, TaskChoice, bridge, errText, toast, useBridgeEvent } from "../shared";
import { Buttons, CheckList, showText, useToggleSet } from "./common";
import { FomodWizard } from "./FomodWizard";

/** Prompt modals that are open now, by task id (so we never stack two for one task). */
const openPrompts = new Map<string, ShowModalResult>();

/** Open the prompt for a task waiting on a choice. No-op if one is already open for it. */
export function openPrompt(task: Task) {
  if (!task.choice || openPrompts.has(task.id)) return;
  const modal = showModal(<TaskPromptModal task={task} />, undefined, {
    fnOnClose: () => openPrompts.delete(task.id),
  });
  openPrompts.set(task.id, modal);
}

export type PromptApi = {
  task: Task;
  busy: boolean;
  /** task_answer, then close. */
  answer: (value: unknown) => void;
  /** task_cancel, then close (no confirmation). */
  cancel: () => void;
  /** "Cancel install?" confirmation, then cancel. */
  askCancel: () => void;
};

function TaskPromptModal({ task, closeModal }: { task: Task; closeModal?: () => void }) {
  const [busy, setBusy] = useState(false);
  const closed = useRef(false);
  const closeModalRef = useRef(closeModal);
  closeModalRef.current = closeModal;
  // Stable for the task, so the check on open below runs once.
  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    openPrompts.delete(task.id);
    closeModalRef.current?.();
  }, [task.id]);

  // Close cleanly when the task moves on without us (finished, cancelled
  // elsewhere, answered from another prompt, or the bridge stopped).
  useBridgeEvent((event, data) => {
    if (event === "bridge_stopped") {
      close();
    } else if (event === "task" && data?.id === task.id && (data as Task).state !== "choice") {
      close();
    }
  });
  useEffect(() => {
    bridge<Task[]>("tasks").then((tasks) => {
      const current = tasks.find((t) => t.id === task.id);
      if (!current || current.state !== "choice") close();
    }, () => {});
  }, [task.id, close]);

  const run = async (fn: () => Promise<unknown>, closeOnError: boolean) => {
    setBusy(true);
    try {
      await fn();
      close();
    } catch (e) {
      toast(errText(e));
      if (closeOnError) close();
    } finally {
      setBusy(false);
    }
  };
  const api: PromptApi = {
    task,
    busy,
    answer: (value) => run(() => bridge("task_answer", { task_id: task.id, value }), false),
    cancel: () => run(() => bridge("task_cancel", { task_id: task.id }), true),
    askCancel: () => showModal(
      <ConfirmModal
        strTitle="Cancel install?"
        strDescription={`Stop installing ${task.title}? Nothing will be installed.`}
        strOKButtonText="Cancel install"
        strCancelButtonText="Keep going"
        bDestructiveWarning
        onOK={() => api.cancel()}
      />),
  };

  const choice = task.choice as TaskChoice;
  return (
    <ModalRoot closeModal={close} onCancel={api.askCancel} bAllowFullSize={choice.kind === "fomod"}
      bDisableBackgroundDismiss bHideCloseIcon>
      <Styles />
      {/* B anywhere inside asks to cancel the task instead of just closing. */}
      <Focusable onCancelButton={swallowB(api.askCancel)} onCancelActionDescription="Cancel install">
        <PromptBody api={api} choice={choice} />
      </Focusable>
    </ModalRoot>
  );
}

function PromptBody({ api, choice }: { api: PromptApi; choice: TaskChoice }): ReactNode {
  switch (choice.kind) {
    case "fomod": return <FomodWizard api={api} />;
    case "bain": return <BainPrompt api={api} choice={choice} />;
    case "exists": return <ExistsPrompt api={api} choice={choice} />;
    default: return <DepsPrompt api={api} choice={choice} />;
  }
}

// ---------- BAIN ----------

type Bain = Extract<TaskChoice, { kind: "bain" }>;

function BainPrompt({ api, choice }: { api: PromptApi; choice: Bain }) {
  const [selected, flip] = useToggleSet(() => choice.packages.filter((pkg) => pkg.default).map((pkg) => pkg.name));
  return (
    <div className="amd-modal amd-modal-medium">
      <h2>Choose packages</h2>
      <div className="amd-sub">{choice.mod} is a BAIN archive. Pick the packages to install; the defaults are checked.</div>
      <CheckList selected={selected} flip={flip} disabled={api.busy}
        items={choice.packages.map((pkg) => ({ key: pkg.name, label: pkg.label || pkg.name, tag: pkg.default && "default" }))} />
      <div className="amd-sub">{selected.size} of {choice.packages.length} selected</div>
      <Buttons>
        {choice.readme.trim() && (
          <DialogButton onClick={() => showText(`${choice.mod}: readme`, choice.readme)}>Readme</DialogButton>
        )}
        <DialogButton disabled={api.busy} onClick={api.cancel}>Cancel</DialogButton>
        <DialogButton disabled={api.busy || !selected.size}
          onClick={() => api.answer(choice.packages.map((pkg) => pkg.name).filter((name) => selected.has(name)))}>
          Install
        </DialogButton>
      </Buttons>
    </div>
  );
}

// ---------- already installed ----------

type Exists = Extract<TaskChoice, { kind: "exists" }>;

function ExistsPrompt({ api, choice }: { api: PromptApi; choice: Exists }) {
  return (
    <div className="amd-modal amd-modal-small">
      <h2>{choice.mod} is already installed</h2>
      <div className="amd-sub">
        Replace overwrites the installed copy. Keep both installs this one next to it under a new name.
      </div>
      <Buttons>
        <DialogButton disabled={api.busy} onClick={() => api.answer("replace")}>Replace</DialogButton>
        <DialogButton disabled={api.busy} onClick={() => api.answer("rename")}>Keep both</DialogButton>
        <DialogButton disabled={api.busy} onClick={api.cancel}>Cancel</DialogButton>
      </Buttons>
    </div>
  );
}

// ---------- Thunderstore dependencies ----------

type Deps = Extract<TaskChoice, { kind: "deps" }>;

function DepsPrompt({ api, choice }: { api: PromptApi; choice: Deps }) {
  const [selected, flip] = useToggleSet(() => choice.packages.map((pkg) => pkg.id));
  return (
    <div className="amd-modal amd-modal-medium">
      <h2>{choice.mod} needs these mods</h2>
      <div className="amd-sub">Checked mods are installed too. Uncheck any you already have from elsewhere.</div>
      <CheckList selected={selected} flip={flip} disabled={api.busy}
        items={choice.packages.map((pkg) => ({
          key: pkg.id,
          label: pkg.label || pkg.id,
          tag: [pkg.version && `v${pkg.version}`, pkg.author && `by ${pkg.author}`].filter(Boolean).join(" · "),
        }))} />
      <Buttons>
        <DialogButton disabled={api.busy} onClick={api.cancel}>Cancel</DialogButton>
        <DialogButton disabled={api.busy}
          onClick={() => api.answer(choice.packages.map((pkg) => pkg.id).filter((id) => selected.has(id)))}>
          {selected.size ? "Install" : "Install without them"}
        </DialogButton>
      </Buttons>
    </div>
  );
}
