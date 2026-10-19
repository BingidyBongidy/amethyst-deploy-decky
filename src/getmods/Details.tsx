import { DialogButton, Focusable, GamepadEvent } from "@decky/ui";
import { ReactNode, useEffect, useRef, useState } from "react";
import { FaDownload, FaStar, FaThumbsUp } from "react-icons/fa";
import { Loading, Note } from "../ui";
import { NexusCard, NexusFile, NexusMod, Task, TsCard, bridge, errText, toast } from "../shared";
import { Item, chunks, compact, day, hideBroken, scrollOnFocus, size } from "./common";

const PREMIUM_NOTE = "Installing from Nexus needs Nexus Premium. With a free account, save the file to Downloads "
  + "from another device and install it from the Downloads tab.";

type Props = {
  item: Item;
  game: string;
  profile: string;
  locked: boolean;
  /** The logged-in Nexus account is Premium. */
  premium: boolean;
  onBack: () => void;
};

/** Start an install task; the task tray takes it from there. */
export async function startInstall(method: string, params: Record<string, unknown>, name: string) {
  try {
    await bridge<Task>(method, params);
    toast(`Installing ${name}`);
  } catch (e) {
    toast(errText(e));
  }
}

/** Mod details inside the tab. B (or the Back button) returns to the results. */
export function Details(p: Props) {
  const backRef = useRef<HTMLDivElement>(null);
  useEffect(() => { backRef.current?.focus(); }, []);

  const onCancel = (e: GamepadEvent) => {
    e.stopPropagation();
    e.preventDefault();
    p.onBack();
  };

  return (
    <Focusable flow-children="vertical" onCancelButton={onCancel} onCancelActionDescription="Back to results"
      style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {p.item.src === "nexus"
        ? <NexusDetails {...p} card={p.item.card} backRef={backRef} />
        : <TsDetails {...p} card={p.item.card} backRef={backRef} />}
    </Focusable>
  );
}

function Header({ picture, name, lines, children }: { picture: string; name: string; lines: ReactNode[]; children?: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 16, padding: "4px 14px 8px", alignItems: "flex-start" }}>
      {picture ? (
        <img src={picture} onError={hideBroken} className="amd-thumb" style={{ width: 256, height: 144 }} />
      ) : <div className="amd-thumb" style={{ width: 256, height: 144 }} />}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 20, fontWeight: 600 }}>{name}</div>
        {lines.filter(Boolean).map((l, i) => <div key={i} className="amd-sub">{l}</div>)}
        {children}
      </div>
    </div>
  );
}

/** Long text as focusable chunks, so the D-pad steps through it and the page scrolls along. */
function TextBlock({ text }: { text: string }) {
  const parts = chunks(text);
  if (!parts.length) return null;
  return (
    <Focusable flow-children="vertical">
      {parts.map((t, i) => (
        <Focusable key={i} className="amd-row" focusClassName="amd-focus" onFocus={scrollOnFocus}
          onActivate={() => {}} style={{ display: "block", whiteSpace: "pre-wrap", lineHeight: 1.5, fontSize: 13 }}>
          {t}
        </Focusable>
      ))}
    </Focusable>
  );
}

const Heading = ({ children }: { children: ReactNode }) => <div className="amd-row amd-sep">{children}</div>;

function NexusDetails(p: Props & { card: NexusCard; backRef: React.RefObject<HTMLDivElement | null> }) {
  const [mod, setMod] = useState<NexusMod | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    setMod(null);
    setError("");
    bridge<NexusMod>("nexus_mod", { game: p.game, mod_id: p.card.id }).then(
      (m) => live && setMod(m), (e) => live && setError(errText(e)));
    return () => { live = false; };
  }, [p.card.id, round]);

  const card: NexusCard = mod ?? p.card;
  const premium = p.premium || !!mod?.premium;
  const canInstall = premium && !p.locked && !busy;

  const install = async (f: NexusFile) => {
    if (!canInstall) return;
    setBusy(true);
    await startInstall("nexus_install",
      { game: p.game, profile: p.profile, mod_id: card.id, file_id: f.id, title: card.name }, card.name);
    setBusy(false);
  };

  return (
    <>
      <Focusable flow-children="horizontal" className="amd-bar" style={{ paddingLeft: 14 }}>
        <DialogButton ref={p.backRef} style={{ width: "auto", minWidth: 120 }} onClick={p.onBack}
>Back</DialogButton>
      </Focusable>
      <Header picture={card.picture} name={card.name} lines={[
        `by ${card.author}${card.version ? ` · version ${card.version}` : ""}${card.category ? ` · ${card.category}` : ""}`,
        <><FaDownload /> {compact(card.downloads)}   <FaThumbsUp /> {compact(card.endorsements)}
          {card.updated ? `   · updated ${day(card.updated)}` : ""}</>,
      ]}>
        {card.summary && <div style={{ fontSize: 14, paddingTop: 4 }}>{card.summary}</div>}
      </Header>

      <Heading>Files</Heading>
      {!premium && <div className="amd-warn" style={{ padding: "4px 14px 8px" }}>{PREMIUM_NOTE}</div>}
      {premium && p.locked && <div className="amd-warn" style={{ padding: "4px 14px 8px" }}>A deploy is running. Install when it finishes.</div>}
      {error ? (
        <Focusable flow-children="vertical">
          <Note>{error}</Note>
          <DialogButton style={{ width: "auto", alignSelf: "flex-start", marginLeft: 14 }}
            onClick={() => setRound((r) => r + 1)}>Retry</DialogButton>
        </Focusable>
      ) : !mod ? <Loading text="Loading files from Nexus Mods…" /> : !mod.files.length ? (
        <Note>This mod has no files to download.</Note>
      ) : (
        <Focusable flow-children="vertical" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {mod.files.map((f) => (
            <Focusable key={f.id} className="amd-card" focusClassName="amd-focus" onFocus={scrollOnFocus}
              style={{ alignItems: "flex-start", opacity: canInstall ? 1 : 0.75 }}
              onActivate={() => install(f)}
              onOKActionDescription={canInstall ? "Install" : undefined}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span className="amd-name" style={{ fontSize: 15 }}>{f.name || f.file_name}</span>
                  {f.primary && <span className="amd-tag">MAIN DOWNLOAD</span>}
                </div>
                <div className="amd-sub">
                  {[f.version && `version ${f.version}`, f.category, size(f.size)].filter(Boolean).join(" · ")}
                </div>
                {f.description && (
                  <div className="amd-sub" style={{ whiteSpace: "pre-wrap", paddingTop: 2 }}>{f.description}</div>
                )}
              </div>
            </Focusable>
          ))}
        </Focusable>
      )}

      {mod?.description && (
        <>
          <Heading>Description</Heading>
          <TextBlock text={mod.description} />
        </>
      )}
    </>
  );
}

function TsDetails(p: Props & { card: TsCard; backRef: React.RefObject<HTMLDivElement | null> }) {
  const [busy, setBusy] = useState(false);
  const c = p.card;
  const name = c.label || c.name;
  const install = async () => {
    if (p.locked || busy) return;
    setBusy(true);
    await startInstall("ts_install", { game: p.game, profile: p.profile, namespace: c.namespace, name: c.name }, name);
    setBusy(false);
  };
  return (
    <>
      <Focusable flow-children="horizontal" className="amd-bar" style={{ paddingLeft: 14 }}>
        <DialogButton ref={p.backRef} style={{ width: "auto", minWidth: 120 }} onClick={p.onBack}
>Back</DialogButton>
        <DialogButton style={{ width: "auto", minWidth: 200 }} disabled={p.locked || busy} onClick={install}>
          {busy ? "Starting…" : "Install latest"}
        </DialogButton>
        {p.locked && <span className="amd-warn">A deploy is running. Install when it finishes.</span>}
      </Focusable>
      <Header picture={c.picture} name={name} lines={[
        `by ${c.author || c.namespace}`,
        <><FaDownload /> {compact(c.downloads)}   <FaStar /> {compact(c.rating)}
          {c.size ? `   · ${size(c.size)}` : ""}{c.updated ? `   · updated ${day(c.updated)}` : ""}</>,
      ]} />
      {c.summary ? (
        <>
          <Heading>Description</Heading>
          <TextBlock text={c.summary} />
        </>
      ) : null}
      <div className="amd-sub" style={{ padding: "8px 14px" }}>
        Installs the newest version. You'll be asked about any dependencies it needs.
      </div>
    </>
  );
}

