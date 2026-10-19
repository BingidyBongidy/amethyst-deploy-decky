import { DialogButton, Focusable } from "@decky/ui";
import { ReactNode, useEffect, useRef, useState } from "react";
import { FaDotCircle, FaHistory, FaLock, FaRegCircle } from "react-icons/fa";
import { Check, Loading } from "../ui";
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
const isRadio = (g: FomodGroup) => g.type === "SelectExactlyOne" || g.type === "SelectAtMostOne";
const optKey = (step: number, group: number, name: string) => `${step}/${group}/${name}`;

type Focused = { step: number; group: number; opt: FomodOption };

export function FomodWizard({ api }: { api: PromptApi }) {
  const id = api.task.id;
  const [view, setView] = useState<FomodView | null>(null);
  const [loadErr, setLoadErr] = useState("");
  /** Current step by its FOMOD index, so we keep our place when visibility changes. */
  const [at, setAt] = useState<number | null>(null);
  const [toggling, setToggling] = useState(false);
  const [focused, setFocused] = useState<Focused | null>(null);
  const images = useRef(new Map<string, string>());
  const [, setImageTick] = useState(0);

  useEffect(() => {
    bridge<FomodView>("fomod_view", { task_id: id }).then(setView, (e) => setLoadErr(errText(e)));
  }, [id]);

  const wrap = (body: ReactNode, buttons: ReactNode) => (
    <div className="amd-modal" style={{ width: "min(1140px, calc(100vw - 100px))", height: "min(640px, calc(100vh - 140px))" }}>
      {body}
      {buttons}
    </div>
  );
  const cancelOnly = (
    <Buttons><DialogButton disabled={api.busy} onClick={api.cancel}>Cancel</DialogButton></Buttons>
  );

  if (loadErr) return wrap(<><h2>{api.task.title}</h2><div className="amd-err">{loadErr}</div></>, cancelOnly);
  if (!view) return wrap(<Loading text="Reading installer…" />, cancelOnly);
  if (!view.steps.length) {
    return wrap(<><h2>{view.title}</h2><div className="amd-sub">This installer has no options to choose.</div></>,
      <Buttons>
        <DialogButton disabled={api.busy} onClick={api.cancel}>Cancel</DialogButton>
        <DialogButton disabled={api.busy} onClick={() => api.answer("install")}>Install</DialogButton>
      </Buttons>);
  }

  // Where are we? If our step was hidden by a toggle, go to the next visible one after it.
  const steps = view.steps;
  let pos = at === null ? 0 : steps.findIndex((s) => s.index === at);
  if (pos < 0) {
    pos = steps.findIndex((s) => s.index > (at ?? 0));
    if (pos < 0) pos = steps.length - 1;
  }
  const step = steps[pos];
  const last = pos === steps.length - 1;
  const stepErrors = view.errors.filter((e) => e.step === step.index);
  const anyErrors = view.errors.filter((e) => steps.some((s) => s.index === e.step));
  const go = (p: number) => {
    setAt(steps[p].index);
    setFocused(null);
  };

  const toggle = async (group: number, opt: FomodOption) => {
    if (toggling || api.busy || opt.locked || opt.type === "NotUsable") return;
    setToggling(true);
    try {
      const v = await bridge<FomodView>("fomod_toggle", { task_id: id, step: step.index, group, name: opt.name });
      setView(v);
      // Refresh the description pane's copy of the option (selected state changed).
      const g = v.steps.find((s) => s.index === step.index)?.groups[group];
      const o = g?.options.find((x) => x.name === opt.name);
      if (o) setFocused({ step: step.index, group, opt: o });
    } catch (e) {
      toast(errText(e));
    } finally {
      setToggling(false);
    }
  };

  const onFocusOpt = (group: number, opt: FomodOption) => {
    setFocused({ step: step.index, group, opt });
    const k = optKey(step.index, group, opt.name);
    if (opt.image && !images.current.has(k)) {
      images.current.set(k, ""); // loading; don't ask twice
      bridge<string>("fomod_image", { task_id: id, step: step.index, group, name: opt.name })
        .then((url) => { images.current.set(k, url || ""); setImageTick((n) => n + 1); }, () => {});
    }
  };

  const fk = focused && focused.step === step.index ? focused : null;
  const fimg = fk ? images.current.get(optKey(fk.step, fk.group, fk.opt.name)) : "";

  const body = (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h2 style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {step.name || view.title}
        </h2>
        <span className="amd-sub" style={{ flex: "none" }}>{view.title} · Step {pos + 1} of {steps.length}</span>
      </div>
      <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0 }}>
        {/* key: a fresh list per step, so focus doesn't linger on a row from the old page */}
        <Focusable key={step.index} flow-children="vertical" className="amd-scrollbox" style={{ flex: "1 1 58%" }}>
          {step.groups.map((g, gi) => (
            <div key={gi} style={{ paddingBottom: 10 }}>
              <div className="amd-row amd-sep" style={{ marginTop: gi ? 6 : 0 }}>
                <span className="amd-name">{g.name}</span>
                <span className="amd-tag" style={{ textTransform: "none", letterSpacing: 0 }}>{HINTS[g.type] ?? g.type}</span>
              </div>
              {g.options.map((o) => (
                <OptionRow key={o.name} group={g} opt={o} busy={toggling || api.busy}
                  onFocus={() => onFocusOpt(gi, o)}
                  onToggle={() => toggle(gi, o)}
                  onDetails={() => showText(o.name, o.description || "No description.",
                    images.current.get(optKey(step.index, gi, o.name)) || undefined)} />
              ))}
            </div>
          ))}
        </Focusable>
        <div style={{ flex: "1 1 42%", minWidth: 0, display: "flex", flexDirection: "column", gap: 8, overflow: "hidden",
          background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: 12 }}>
          {fk ? (
            <>
              <div style={{ fontWeight: 700 }}>{fk.opt.name}</div>
              {fk.opt.image && (fimg
                ? <img src={fimg} style={{ maxWidth: "100%", maxHeight: 240, objectFit: "contain", alignSelf: "center", borderRadius: 4 }} />
                : <div className="amd-sub">Loading image…</div>)}
              <div style={{ fontSize: 13, lineHeight: 1.4, whiteSpace: "pre-wrap", overflow: "hidden", flex: 1, minHeight: 0,
                WebkitMaskImage: "linear-gradient(to bottom, black 85%, transparent)" }}>
                {fk.opt.description || <span className="amd-sub">No description.</span>}
              </div>
              {fk.opt.description && <div className="amd-sub">Press X to read it all.</div>}
            </>
          ) : (
            <div className="amd-sub">Move to an option to see its description and picture.</div>
          )}
        </div>
      </div>
      {stepErrors.map((e, i) => <div key={i} className="amd-err">{e.message}</div>)}
      {last && !stepErrors.length && anyErrors.length > 0 && (
        <div className="amd-err">An earlier step still needs attention: {anyErrors[0].message}</div>
      )}
    </>
  );

  const buttons = (
    <Buttons>
      <DialogButton disabled={api.busy} onClick={api.cancel}>Cancel</DialogButton>
      <DialogButton disabled={api.busy || pos === 0} onClick={() => go(pos - 1)}>Back</DialogButton>
      {last ? (
        <DialogButton disabled={api.busy || toggling || anyErrors.length > 0} onClick={() => api.answer("install")}>
          Install
        </DialogButton>
      ) : (
        <DialogButton disabled={api.busy || toggling || stepErrors.length > 0} onClick={() => go(pos + 1)}>
          Next
        </DialogButton>
      )}
    </Buttons>
  );

  return wrap(body, buttons);
}

function OptionRow({ group, opt, busy, onFocus, onToggle, onDetails }: {
  group: FomodGroup; opt: FomodOption; busy: boolean;
  onFocus: () => void; onToggle: () => void; onDetails: () => void;
}) {
  const fixed = opt.locked || opt.type === "NotUsable";
  const radio = isRadio(group);
  const mark = radio
    ? (opt.selected ? <FaDotCircle /> : <FaRegCircle style={{ opacity: 0.6 }} />)
    : <Check on={opt.selected} />;
  return (
    <Focusable
      className={`amd-row${fixed ? " amd-dim" : ""}`}
      focusClassName="amd-focus"
      onFocus={(e) => {
        (e.currentTarget as HTMLElement).scrollIntoView?.({ block: "nearest" });
        onFocus();
      }}
      onActivate={() => !busy && onToggle()}
      onSecondaryButton={onDetails}
      onOKActionDescription={fixed || busy ? undefined : radio ? (opt.selected ? (group.type === "SelectAtMostOne" ? "Clear" : undefined) : "Choose") : (opt.selected ? "Uncheck" : "Check")}
      onSecondaryActionDescription="Description"
    >
      {mark}
      <span className="amd-name">{opt.name}</span>
      {opt.previous && <span className="amd-tag" title="Chosen last time"><FaHistory /> last time</span>}
      {opt.type === "Required" && <span className="amd-badge amd-req">Required</span>}
      {opt.type === "Recommended" && <span className="amd-badge amd-rec">Recommended</span>}
      {opt.type === "NotUsable" && <span className="amd-badge">Not usable</span>}
      {opt.missing && <span className="amd-warn">files missing</span>}
      {opt.locked && <FaLock style={{ opacity: 0.6 }} />}
    </Focusable>
  );
}
