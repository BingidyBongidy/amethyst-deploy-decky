import { ConfirmModal, DialogButton, Dropdown, Focusable, showModal } from "@decky/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loading, RetryNote } from "../ui";
import { BridgeGame, NexusStatus, TabProps, bridge, errText, toast } from "../shared";
import { Item, SITE_NAMES, Source } from "./common";
import { Details } from "./Details";
import { NexusLogin } from "./NexusLogin";
import { Results } from "./Results";
import { NotOnSite, OtherSites } from "./SiteNotes";

/** What the site picker shows: a mod site, or "Other sites" (the Downloads tab). */
type View = Source | "other";

/** Last view picked, per game (module-level, so it survives tab switches). */
const sourceByGame = new Map<string, View>();

type GetModsProps = TabProps & {
  /** Switch the page to the Downloads tab (from "Other sites"). */
  onOpenDownloads?: () => void;
};

/** Browse, search and install from Nexus Mods (Premium) and Thunderstore. */
export function GetModsTab(props: GetModsProps) {
  // Remount per game so every piece of state starts fresh.
  return <GetMods key={props.game.name} {...props} />;
}

// Baldur's Gate 3's official mod site is mod.io, browsed from inside the game.
const isBG3 = (domain: string) => domain === "baldursgate3";

type Available = Record<Source, boolean>;

/** Thunderstore first: a game on it is usually modded from there. */
function defaultView(available: Available): View {
  if (available.ts) return "ts";
  if (available.nexus) return "nexus";
  return "other";
}

/** The other site this game is on, to offer when the picked one doesn't have it. */
function siteWithGame(available: Available): Source | undefined {
  if (available.nexus) return "nexus";
  if (available.ts) return "ts";
  return undefined;
}

/** The picked view, remembered per game; `src` is the site browsed, if this game is on it. */
function useSiteView(game: BridgeGame) {
  const available: Available = { nexus: !!game.nexus_domain, ts: !!game.ts_community };
  const [view, setViewState] = useState<View>(() => sourceByGame.get(game.name) ?? defaultView(available));
  const setView = (next: View) => {
    sourceByGame.set(game.name, next);
    setViewState(next);
  };
  const src: Source | null = view !== "other" && available[view] ? view : null;
  return { view, setView, src, available };
}

/** The Nexus account (the bridge caches nexus_status, so asking on every mount is cheap). */
function useNexusAccount(active: boolean, locked: boolean) {
  const [status, setStatus] = useState<NexusStatus | null>(null);
  const [error, setError] = useState("");
  // Read by the effect below, which should run when the site or the lock changes, not the status.
  const statusRef = useRef(status);
  statusRef.current = status;

  const load = useCallback((refresh: boolean) => {
    setError("");
    if (refresh) setStatus(null);
    bridge<NexusStatus>("nexus_status", refresh ? { refresh: true } : {}).then(setStatus, (e) => setError(errText(e)));
  }, []);

  useEffect(() => {
    if (active && !statusRef.current && !locked) load(false);
  }, [active, locked, load]);

  const logout = () => showModal(
    <ConfirmModal strTitle="Log out of Nexus Mods?"
      strDescription="Amethyst forgets your Nexus login. You can log in again any time."
      strOKButtonText="Log out" bDestructiveWarning
      onOK={async () => {
        try {
          await bridge("nexus_logout");
          setStatus({ logged_in: false });
          toast("Logged out of Nexus Mods");
        } catch (e) {
          toast(errText(e));
        }
      }} />);

  return { status, setStatus, error, retry: () => load(true), logout };
}

type NexusAccount = ReturnType<typeof useNexusAccount>;

function GetMods({ game, profile, locked, onOpenDownloads }: GetModsProps) {
  const site = useSiteView(game);
  const nexus = useNexusAccount(site.src === "nexus", locked);
  // Details view (inside the tab); remembers which card to refocus on return.
  const [open, setOpen] = useState<Item | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const pickView = (view: View) => {
    setOpen(null);
    site.setView(view);
  };
  const openItem = (item: Item) => {
    setFocusKey(item.key);
    setOpen(item);
  };
  const otherSite = siteWithGame(site.available);

  const body = () => {
    if (site.view === "other") {
      return <OtherSites game={game.name} bg3={isBG3(game.nexus_domain)} onOpenDownloads={onOpenDownloads} />;
    }
    if (!site.src) {
      return <NotOnSite game={game.name} site={site.view} onOther={() => site.setView("other")}
        onSwitch={otherSite ? () => site.setView(otherSite) : undefined}
        switchLabel={`Browse ${SITE_NAMES[otherSite ?? "ts"]}`} />;
    }
    if (site.src === "nexus" && !nexus.status?.logged_in) return <NexusSignIn nexus={nexus} locked={locked} />;
    if (open) {
      return <Details item={open} game={game.name} profile={profile} locked={locked} premium={!!nexus.status?.premium}
        onBack={() => setOpen(null)} />;
    }
    return <Results key={site.src} src={site.src} game={game.name} profile={profile} locked={locked}
      focusKey={focusKey} onOpen={openItem} />;
  };

  return (
    <Focusable flow-children="vertical" className="amd-stack">
      <SiteBar game={game} view={site.view} available={site.available} onPick={pickView} locked={locked}
        account={site.src === "nexus" ? nexus.status : null} onLogout={nexus.logout} />
      {body()}
    </Focusable>
  );
}

/** Not logged in to Nexus: the status check, its error, or the login steps. */
function NexusSignIn({ nexus, locked }: { nexus: NexusAccount; locked: boolean }) {
  if (nexus.error) return <RetryNote error={nexus.error} onRetry={nexus.retry} />;
  if (!nexus.status) {
    return <Loading text={locked ? "Waiting for the deploy to finish…" : "Checking your Nexus Mods account…"} />;
  }
  return <NexusLogin status={nexus.status} onStatus={nexus.setStatus} />;
}

/** Site picker, the Nexus account (when browsing Nexus), and notes about the deploy lock and BG3. */
function SiteBar({ game, view, available, onPick, locked, account, onLogout }: {
  game: BridgeGame; view: View; available: Available; onPick: (view: View) => void; locked: boolean;
  /** The Nexus account while browsing Nexus, else null. */
  account: NexusStatus | null;
  onLogout: () => void;
}) {
  const notHere = (src: Source) => (available[src] ? "" : " (not for this game)");
  return (
    <Focusable className="amd-bar amd-wrap" flow-children="horizontal">
      <div className="amd-min-260">
        <Dropdown
          rgOptions={[
            { data: "nexus", label: `Site: Nexus Mods${notHere("nexus")}` },
            { data: "ts", label: `Site: Thunderstore${notHere("ts")}` },
            { data: "other", label: "Site: Other sites" },
          ]}
          selectedOption={view}
          onChange={(option) => onPick(option.data)}
        />
      </div>
      {account?.logged_in && (
        <>
          <span className="amd-sub">
            {account.name ?? "Logged in"} · <span className={account.premium ? "" : "amd-warn"}>{account.premium ? "Premium" : "Free account"}</span>
          </span>
          <DialogButton className="amd-button-auto amd-min-110" onClick={onLogout}>Log out</DialogButton>
        </>
      )}
      {locked && <span className="amd-warn">A deploy is running. Installs are paused.</span>}
      {isBG3(game.nexus_domain) && view !== "other" && (
        <span className="amd-sub amd-full-row">
          mod.io mods for {game.name} are in the game's own Mod Manager (main menu).
        </span>
      )}
    </Focusable>
  );
}
