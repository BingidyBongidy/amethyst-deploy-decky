import { ConfirmModal, DialogButton, Focusable, ModalRoot, showModal, ShowModalResult } from "@decky/ui";
import { ReactNode, useEffect, useRef, useState } from "react";
import { ensureStyles, swallowB } from "../ui";
import { Task, TaskChoice, bridge, errText, toast, useBridgeEvent } from "../shared";
import { Buttons, CheckList, showText, useToggleSet } from "./common";
import { FomodWizard } from "./FomodWizard";

/** Prompt modals that are open now, by task id (so we never stack two for one task). */
const openPrompts = new Map<string, ShowModalResult>();

/** Open the prompt for a task waiting on a choice. No-op if one is already open for it. */
export function openPrompt(task: Task) {
  if (!task.choice || openPrompts.has(task.id)) return;
  ensureStyles();
  const r = showModal(<TaskPromptModal task={task} />, undefined, {
    fnOnClose: () => openPrompts.delete(task.id),
  });
  openPrompts.set(task.id, r);
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
  const close = () => {
    if (closed.current) return;
    closed.current = true;
    openPrompts.delete(task.id);
    closeModal?.();
  };

  // Close cleanly when the task moves on without us (finished, cancelled
  // elsewhere, answered from another prompt, or the bridge stopped).
  useBridgeEvent((event, data) => {
    if (event === "bridge_stopped") close();
    else if (event === "task" && data?.id === task.id && (data as Task).state !== "choice") close();
  });
  useEffect(() => {
    bridge<Task[]>("tasks").then((ts) => {
      const t = ts.find((x) => x.id === task.id);
      if (!t || t.state !== "choice") close();
    }, () => {});
  }, []);

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
  let body: ReactNode;
  if (choice.kind === "fomod") body = <FomodWizard api={api} />;
  else if (choice.kind === "bain") body = <BainPrompt api={api} choice={choice} />;
  else if (choice.kind === "exists") body = <ExistsPrompt api={api} choice={choice} />;
  else body = <DepsPrompt api={api} choice={choice} />;

  return (
    <ModalRoot closeModal={close} onCancel={api.askCancel} bAllowFullSize={choice.kind === "fomod"}
      bDisableBackgroundDismiss bHideCloseIcon>
      {/* B anywhere inside asks to cancel the task instead of just closing. */}
      <Focusable onCancelButton={swallowB(api.askCancel)} onCancelActionDescription="Cancel install">
        {body}
      </Focusable>
    </ModalRoot>
  );
}

// ---------- BAIN ----------

type Bain = Extract<TaskChoice, { kind: "bain" }>;

function BainPrompt({ api, choice }: { api: PromptApi; choice: Bain }) {
  const [sel, flip] = useToggleSet(() => choice.packages.filter((p) => p.default).map((p) => p.name));
  return (
    <div className="amd-modal" style={{ width: "min(760px, calc(100vw - 140px))" }}>
      <h2>Choose packages</h2>
      <div className="amd-sub">{choice.mod} is a BAIN archive. Pick the packages to install; the defaults are checked.</div>
      <CheckList sel={sel} flip={flip} disabled={api.busy}
        items={choice.packages.map((p) => ({ key: p.name, label: p.label || p.name, tag: p.default && "default" }))} />
      <div className="amd-sub">{sel.size} of {choice.packages.length} selected</div>
      <Buttons>
        {choice.readme.trim() && (
          <DialogButton onClick={() => showText(`${choice.mod}: readme`, choice.readme)}>Readme</DialogButton>
        )}
        <DialogButton disabled={api.busy} onClick={api.cancel}>Cancel</DialogButton>
        <DialogButton disabled={api.busy || !sel.size}
          onClick={() => api.answer(choice.packages.map((p) => p.name).filter((n) => sel.has(n)))}>
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
    <div className="amd-modal" style={{ width: "min(640px, calc(100vw - 140px))" }}>
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
  const [sel, flip] = useToggleSet(() => choice.packages.map((p) => p.id));
  return (
    <div className="amd-modal" style={{ width: "min(760px, calc(100vw - 140px))" }}>
      <h2>{choice.mod} needs these mods</h2>
      <div className="amd-sub">Checked mods are installed too. Uncheck any you already have from elsewhere.</div>
      <CheckList sel={sel} flip={flip} disabled={api.busy}
        items={choice.packages.map((p) => ({
          key: p.id, label: p.label || p.id,
          tag: [p.version && `v${p.version}`, p.author && `by ${p.author}`].filter(Boolean).join(" · "),
        }))} />
      <Buttons>
        <DialogButton disabled={api.busy} onClick={api.cancel}>Cancel</DialogButton>
        <DialogButton disabled={api.busy}
          onClick={() => api.answer(choice.packages.map((p) => p.id).filter((id) => sel.has(id)))}>
          {sel.size ? "Install" : "Install without them"}
        </DialogButton>
      </Buttons>
    </div>
  );
}
