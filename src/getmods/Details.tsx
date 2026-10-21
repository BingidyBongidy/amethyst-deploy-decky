import { DialogButton, Focusable, Navigation } from "@decky/ui";
import { ReactNode, RefObject, useEffect, useRef, useState } from "react";
import { FaDownload, FaStar, FaThumbsUp } from "react-icons/fa";
import { Loading, LongText, Note, RetryNote, formatSize, scrollOnFocus, swallowB } from "../ui";
import { NexusCard, NexusFile, NexusMod, Task, TsCard, bridge, errText, startInstall, toast } from "../shared";
import { Item, compact, day, hideBroken } from "./common";

const FREE_NOTE = "Free account: pressing a file opens its Nexus page. Use the trackpad to press "
  + "Slow download (log in to the Nexus site there the first time); it installs as soon as the download finishes.";

type Props = {
  item: Item;
  game: string;
  profile: string;
  locked: boolean;
  /** The logged-in Nexus account is Premium. */
  premium: boolean;
  onBack: () => void;
};

type BackRef = RefObject<HTMLDivElement | null>;

/** Mod details inside the tab. B (or the Back button) returns to the results. */
export function Details(props: Props) {
  const backRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    backRef.current?.focus();
  }, []);

  return (
    <Focusable flow-children="vertical" onCancelButton={swallowB(props.onBack)} onCancelActionDescription="Back to results"
      className="amd-stack amd-gap-4">
      {props.item.src === "nexus"
        ? <NexusDetails {...props} card={props.item.card} backRef={backRef} />
        : <TsDetails {...props} card={props.item.card} backRef={backRef} />}
    </Focusable>
  );
}

function Header({ picture, name, lines, children }: { picture: string; name: string; lines: ReactNode[]; children?: ReactNode }) {
  return (
    <div className="amd-details-header">
      {picture
        ? <img src={picture} onError={hideBroken} className="amd-thumb amd-thumb-large" />
        : <div className="amd-thumb amd-thumb-large" />}
      <div className="amd-grow amd-stack amd-gap-4">
        <div className="amd-title-large">{name}</div>
        {lines.filter(Boolean).map((line, i) => <div key={i} className="amd-sub">{line}</div>)}
        {children}
      </div>
    </div>
  );
}

const BackButton = ({ backRef, onBack }: { backRef: BackRef; onBack: () => void }) => (
  <DialogButton ref={backRef} className="amd-button-auto amd-min-120" onClick={onBack}>Back</DialogButton>
);

/** Description text, lined up with the rows around it. */
const TextBlock = ({ text }: { text: string }) => <LongText text={text} className="amd-text-block" />;

const Heading = ({ children }: { children: ReactNode }) => <div className="amd-row amd-sep">{children}</div>;

/** "by Author · version 1.2 · Category" */
const nexusByline = (card: NexusCard) =>
  `by ${card.author}${card.version ? ` · version ${card.version}` : ""}${card.category ? ` · ${card.category}` : ""}`;

/** The full mod (files, description) for a Nexus card; `retry` asks again after an error. */
function useNexusMod(game: string, modId: number) {
  const [mod, setMod] = useState<NexusMod | null>(null);
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    setMod(null);
    setError("");
    bridge<NexusMod>("nexus_mod", { game, mod_id: modId }).then(
      (loaded) => live && setMod(loaded), (e) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [game, modId, round]);

  return { mod, error, retry: () => setRound((n) => n + 1) };
}

/**
 * Nexus only lets free accounts download from its own page: open it in
 * Steam's browser; the bridge installs the file when it lands in Downloads.
 */
async function installFromNexusPage(params: Record<string, unknown>, name: string) {
  try {
    const reply = await bridge<{ task: Task; url: string }>("nexus_manual_install", params);
    if (reply.url) {
      Navigation.NavigateToExternalWeb(reply.url);
      toast(`Press Slow download for ${name}. It installs when the download finishes.`);
    } else {
      toast(`Installing ${name} (already in Downloads)`);
    }
  } catch (e) {
    toast(errText(e));
  }
}

/** What A does on a file: install it (Premium) or open its download page (free). */
function fileActionLabel(canInstall: boolean, premium: boolean): string | undefined {
  if (!canInstall) return undefined;
  return premium ? "Install" : "Open download page";
}

function NexusDetails(props: Props & { card: NexusCard; backRef: BackRef }) {
  const { mod, error, retry } = useNexusMod(props.game, props.card.id);
  const [busy, setBusy] = useState(false);

  const card: NexusCard = mod ?? props.card;
  const premium = props.premium || !!mod?.premium;
  const canInstall = !props.locked && !busy;

  const install = async (file: NexusFile) => {
    if (!canInstall) return;
    setBusy(true);
    const params = { game: props.game, profile: props.profile, mod_id: card.id, file_id: file.id, title: card.name };
    if (premium) {
      await startInstall("nexus_install", params, card.name);
    } else {
      await installFromNexusPage(params, card.name);
    }
    setBusy(false);
  };

  return (
    <>
      <Focusable flow-children="horizontal" className="amd-bar amd-indent">
        <BackButton backRef={props.backRef} onBack={props.onBack} />
      </Focusable>
      <Header picture={card.picture} name={card.name} lines={[
        nexusByline(card),
        <><FaDownload /> {compact(card.downloads)}   <FaThumbsUp /> {compact(card.endorsements)}
          {card.updated ? `   · updated ${day(card.updated)}` : ""}</>,
      ]}>
        {card.summary && <div className="amd-summary">{card.summary}</div>}
      </Header>

      <Heading>Files</Heading>
      {!premium && <div className="amd-sub amd-inset">{FREE_NOTE}</div>}
      {props.locked && <div className="amd-warn amd-inset">A deploy is running. Install when it finishes.</div>}
      <NexusFiles mod={mod} error={error} onRetry={retry}
        installLabel={fileActionLabel(canInstall, premium)} onInstall={install} />

      {mod?.description && (
        <>
          <Heading>Description</Heading>
          <TextBlock text={mod.description} />
        </>
      )}
    </>
  );
}

function NexusFiles({ mod, error, onRetry, installLabel, onInstall }: {
  mod: NexusMod | null; error: string; onRetry: () => void;
  /** The A hint; undefined while installing isn't possible. */
  installLabel: string | undefined;
  onInstall: (file: NexusFile) => void;
}) {
  if (error) return <RetryNote error={error} onRetry={onRetry} />;
  if (!mod) return <Loading text="Loading files from Nexus Mods…" />;
  if (!mod.files.length) return <Note>This mod has no files to download.</Note>;
  return (
    <Focusable flow-children="vertical" className="amd-list">
      {mod.files.map((file) => (
        <Focusable key={file.id} className={`amd-card amd-align-start${installLabel ? "" : " amd-unavailable"}`}
          focusClassName="amd-focus" onFocus={scrollOnFocus}
          onActivate={() => onInstall(file)}
          onOKActionDescription={installLabel}>
          <div className="amd-grow">
            <div className="amd-title-row">
              <span className="amd-name amd-card-title">{file.name || file.file_name}</span>
              {file.primary && <span className="amd-tag">MAIN DOWNLOAD</span>}
            </div>
            <div className="amd-sub">
              {[file.version && `version ${file.version}`, file.category, formatSize(file.size)].filter(Boolean).join(" · ")}
            </div>
            {file.description && <div className="amd-sub amd-file-description">{file.description}</div>}
          </div>
        </Focusable>
      ))}
    </Focusable>
  );
}

function TsDetails(props: Props & { card: TsCard; backRef: BackRef }) {
  const [busy, setBusy] = useState(false);
  const card = props.card;
  const name = card.label || card.name;
  const install = async () => {
    if (props.locked || busy) return;
    setBusy(true);
    await startInstall("ts_install", { game: props.game, profile: props.profile, namespace: card.namespace, name: card.name }, name);
    setBusy(false);
  };
  return (
    <>
      <Focusable flow-children="horizontal" className="amd-bar amd-indent">
        <BackButton backRef={props.backRef} onBack={props.onBack} />
        <DialogButton className="amd-button-auto amd-min-200" disabled={props.locked || busy} onClick={install}>
          {busy ? "Starting…" : "Install latest"}
        </DialogButton>
        {props.locked && <span className="amd-warn">A deploy is running. Install when it finishes.</span>}
      </Focusable>
      <Header picture={card.picture} name={name} lines={[
        `by ${card.author || card.namespace}`,
        <><FaDownload /> {compact(card.downloads)}   <FaStar /> {compact(card.rating)}
          {card.size ? `   · ${formatSize(card.size)}` : ""}{card.updated ? `   · updated ${day(card.updated)}` : ""}</>,
      ]} />
      {card.summary ? (
        <>
          <Heading>Description</Heading>
          <TextBlock text={card.summary} />
        </>
      ) : null}
      <div className="amd-sub amd-pad">
        Installs the newest version. You'll be asked about any dependencies it needs.
      </div>
    </>
  );
}
