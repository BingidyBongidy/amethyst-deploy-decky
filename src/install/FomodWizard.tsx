import { DialogButton, Focusable } from "@decky/ui";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { FaDotCircle, FaHistory, FaLock, FaRegCircle } from "react-icons/fa";
import { Check, Loading, scrollOnFocus } from "../ui";
import { FomodGroup, FomodOption, FomodView, bridge, errText, toast } from "../shared";
import { Buttons, showText } from "./common";
import type { PromptApi } from "./prompts";

// FOMOD wizard: one page per visible step, groups with their selection rule,
// and a description/image pane. The bridge owns all FOMOD logic; we only render.

const HINTS: Record<string, string> = {
  SelectExactlyOne: "Pick one",
  SelectAtMostOne: "Pick one or none",
  SelectAtLeastOne: "Pick at least one",
  SelectAny: "Pick any",
  SelectAll: "All included",
};
const isRadio = (group: FomodGroup) => group.type === "SelectExactlyOne" || group.type === "SelectAtMostOne";
const isFixed = (opt: FomodOption) => opt.locked || opt.type === "NotUsable";
const optKey = (step: number, group: number, name: string) => `${step}/${group}/${name}`;

type Step = FomodView["steps"][number];
type Focused = { step: number; group: number; opt: FomodOption };

/**
 * Position of the current step among the visible ones. `at` is the step's FOMOD
 * index; if a toggle hid that step, go to the next visible one after it.
 */
function stepPosition(steps: Step[], at: number | null): number {
  if (at === null) return 0;
  const exact = steps.findIndex((s) => s.index === at);
  if (exact >= 0) return exact;
  const next = steps.findIndex((s) => s.index > at);
  return next >= 0 ? next : steps.length - 1;
}

/** Option pictures, fetched once each when an option is first focused. */
function useOptionImages(taskId: string) {
  const images = useRef(new Map<string, string>());
  const [, setImageTick] = useState(0);

  const request = useCallback((step: number, group: number, opt: FomodOption) => {
    const key = optKey(step, group, opt.name);
    if (!opt.image || images.current.has(key)) return;
    images.current.set(key, ""); // loading; don't ask twice
    bridge<string>("fomod_image", { task_id: taskId, step, group, name: opt.name }).then((url) => {
      images.current.set(key, url || "");
      setImageTick((n) => n + 1);
    }, () => {});
  }, [taskId]);

  const get = (step: number, group: number, name: string) => images.current.get(optKey(step, group, name));
  return { request, get };
}

/** The modal's frame: content, then the button row. */
const Frame = ({ children, buttons }: { children: ReactNode; buttons: ReactNode }) => (
  <div className="amd-modal amd-modal-fomod">
    {children}
    {buttons}
  </div>
);

export function FomodWizard({ api }: { api: PromptApi }) {
  const taskId = api.task.id;
  const [view, setView] = useState<FomodView | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    bridge<FomodView>("fomod_view", { task_id: taskId }).then(setView, (e) => setLoadError(errText(e)));
  }, [taskId]);

  const cancelOnly = (
    <Buttons><DialogButton disabled={api.busy} onClick={api.cancel}>Cancel</DialogButton></Buttons>
  );
  if (loadError) {
    return (
      <Frame buttons={cancelOnly}>
        <h2>{api.task.title}</h2>
        <div className="amd-err">{loadError}</div>
      </Frame>
    );
  }
  if (!view) return <Frame buttons={cancelOnly}><Loading text="Reading installer…" /></Frame>;
  if (!view.steps.length) return <NoOptions api={api} title={view.title} />;
  return <Wizard api={api} view={view} onView={setView} />;
}

function NoOptions({ api, title }: { api: PromptApi; title: string }) {
  const buttons = (
    <Buttons>
      <DialogButton disabled={api.busy} onClick={api.cancel}>Cancel</DialogButton>
      <DialogButton disabled={api.busy} onClick={() => api.answer("install")}>Install</DialogButton>
    </Buttons>
  );
  return (
    <Frame buttons={buttons}>
      <h2>{title}</h2>
      <div className="amd-sub">This installer has no options to choose.</div>
    </Frame>
  );
}

/** The steps of an installer that has options. */
function Wizard({ api, view, onView }: { api: PromptApi; view: FomodView; onView: (view: FomodView) => void }) {
  const taskId = api.task.id;
  /** Current step by its FOMOD index, so we keep our place when visibility changes. */
  const [at, setAt] = useState<number | null>(null);
  const [toggling, setToggling] = useState(false);
  const [focused, setFocused] = useState<Focused | null>(null);
  const images = useOptionImages(taskId);

  const steps = view.steps;
  const pos = stepPosition(steps, at);
  const step = steps[pos];
  const stepErrors = view.errors.filter((e) => e.step === step.index);
  const visibleErrors = view.errors.filter((e) => steps.some((s) => s.index === e.step));
  const goTo = (position: number) => {
    setAt(steps[position].index);
    setFocused(null);
  };

  const toggle = async (group: number, opt: FomodOption) => {
    if (toggling || api.busy || isFixed(opt)) return;
    setToggling(true);
    try {
      const next = await bridge<FomodView>("fomod_toggle", { task_id: taskId, step: step.index, group, name: opt.name });
      onView(next);
      // Refresh the description pane's copy of the option (selected state changed).
      const sameStep = next.steps.find((s) => s.index === step.index);
      const updated = sameStep?.groups[group]?.options.find((o) => o.name === opt.name);
      if (updated) setFocused({ step: step.index, group, opt: updated });
    } catch (e) {
      toast(errText(e));
    } finally {
      setToggling(false);
    }
  };

  const onFocusOption = (group: number, opt: FomodOption) => {
    setFocused({ step: step.index, group, opt });
    images.request(step.index, group, opt);
  };

  const focusedHere = focused && focused.step === step.index ? focused : null;
  const busy = api.busy || toggling;
  const buttons = (
    <Buttons>
      <DialogButton disabled={api.busy} onClick={api.cancel}>Cancel</DialogButton>
      <DialogButton disabled={api.busy || pos === 0} onClick={() => goTo(pos - 1)}>Back</DialogButton>
      {pos === steps.length - 1 ? (
        <DialogButton disabled={busy || visibleErrors.length > 0} onClick={() => api.answer("install")}>
          Install
        </DialogButton>
      ) : (
        <DialogButton disabled={busy || stepErrors.length > 0} onClick={() => goTo(pos + 1)}>
          Next
        </DialogButton>
      )}
    </Buttons>
  );

  return (
    <Frame buttons={buttons}>
      <div className="amd-step-header">
        <h2 className="amd-grow amd-ellipsis">{step.name || view.title}</h2>
        <span className="amd-sub amd-fixed">{view.title} · Step {pos + 1} of {steps.length}</span>
      </div>
      <div className="amd-fomod-columns">
        {/* key: a fresh list per step, so focus doesn't linger on a row from the old page */}
        <Focusable key={step.index} flow-children="vertical" className="amd-scrollbox amd-fomod-options">
          {step.groups.map((group, groupIndex) => (
            <GroupOptions key={groupIndex} group={group} busy={busy}
              onFocus={(opt) => onFocusOption(groupIndex, opt)}
              onToggle={(opt) => toggle(groupIndex, opt)}
              onDetails={(opt) => showText(opt.name, opt.description || "No description.",
                images.get(step.index, groupIndex, opt.name) || undefined)} />
          ))}
        </Focusable>
        <DescriptionPane focused={focusedHere}
          image={focusedHere ? images.get(focusedHere.step, focusedHere.group, focusedHere.opt.name) : ""} />
      </div>
      <StepErrors stepErrors={stepErrors} lastStep={pos === steps.length - 1} visibleErrors={visibleErrors} />
    </Frame>
  );
}

function GroupOptions({ group, busy, onFocus, onToggle, onDetails }: {
  group: FomodGroup; busy: boolean;
  onFocus: (opt: FomodOption) => void; onToggle: (opt: FomodOption) => void; onDetails: (opt: FomodOption) => void;
}) {
  return (
    <div className="amd-fomod-group">
      <div className="amd-row amd-sep">
        <span className="amd-name">{group.name}</span>
        <span className="amd-tag amd-hint-tag">{HINTS[group.type] ?? group.type}</span>
      </div>
      {group.options.map((opt) => (
        <OptionRow key={opt.name} group={group} opt={opt} busy={busy}
          onFocus={() => onFocus(opt)}
          onToggle={() => onToggle(opt)}
          onDetails={() => onDetails(opt)} />
      ))}
    </div>
  );
}

/** The focused option's name, picture and the start of its description. */
function DescriptionPane({ focused, image }: { focused: Focused | null; image: string | undefined }) {
  if (!focused) {
    return (
      <div className="amd-fomod-pane">
        <div className="amd-sub">Move to an option to see its description and picture.</div>
      </div>
    );
  }
  const opt = focused.opt;
  return (
    <div className="amd-fomod-pane">
      <div className="amd-bold">{opt.name}</div>
      {opt.image && <OptionImage url={image} />}
      <div className="amd-fomod-description">
        {opt.description || <span className="amd-sub">No description.</span>}
      </div>
      {opt.description && <div className="amd-sub">Press X to read it all.</div>}
    </div>
  );
}

const OptionImage = ({ url }: { url: string | undefined }) =>
  (url ? <img src={url} className="amd-fomod-image" /> : <div className="amd-sub">Loading image…</div>);

function StepErrors({ stepErrors, lastStep, visibleErrors }: {
  stepErrors: FomodView["errors"]; lastStep: boolean; visibleErrors: FomodView["errors"];
}) {
  return (
    <>
      {stepErrors.map((e, i) => <div key={i} className="amd-err">{e.message}</div>)}
      {lastStep && !stepErrors.length && visibleErrors.length > 0 && (
        <div className="amd-err">An earlier step still needs attention: {visibleErrors[0].message}</div>
      )}
    </>
  );
}

/** What A does on an option, for the button hint; undefined when it does nothing. */
function toggleLabel(group: FomodGroup, opt: FomodOption): string | undefined {
  if (!isRadio(group)) return opt.selected ? "Uncheck" : "Check";
  if (!opt.selected) return "Choose";
  // A chosen radio option can only be cleared when the group allows none.
  return group.type === "SelectAtMostOne" ? "Clear" : undefined;
}

function OptionMark({ group, opt }: { group: FomodGroup; opt: FomodOption }) {
  if (!isRadio(group)) return <Check on={opt.selected} />;
  return opt.selected ? <FaDotCircle /> : <FaRegCircle className="amd-faint" />;
}

function OptionRow({ group, opt, busy, onFocus, onToggle, onDetails }: {
  group: FomodGroup; opt: FomodOption; busy: boolean;
  onFocus: () => void; onToggle: () => void; onDetails: () => void;
}) {
  const fixed = isFixed(opt);
  return (
    <Focusable
      className={`amd-row${fixed ? " amd-dim" : ""}`}
      focusClassName="amd-focus"
      onFocus={(e) => {
        scrollOnFocus(e);
        onFocus();
      }}
      onActivate={() => !busy && onToggle()}
      onSecondaryButton={onDetails}
      onOKActionDescription={fixed || busy ? undefined : toggleLabel(group, opt)}
      onSecondaryActionDescription="Description"
    >
      <OptionMark group={group} opt={opt} />
      <span className="amd-name">{opt.name}</span>
      {opt.previous && <span className="amd-tag" title="Chosen last time"><FaHistory /> last time</span>}
      {opt.type === "Required" && <span className="amd-badge amd-req">Required</span>}
      {opt.type === "Recommended" && <span className="amd-badge amd-rec">Recommended</span>}
      {opt.type === "NotUsable" && <span className="amd-badge">Not usable</span>}
      {opt.missing && <span className="amd-warn">files missing</span>}
      {opt.locked && <FaLock className="amd-faint" />}
    </Focusable>
  );
}
