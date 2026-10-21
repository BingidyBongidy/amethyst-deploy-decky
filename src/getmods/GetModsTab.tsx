import { ConfirmModal, DialogButton, Dropdown, Focusable, showModal, TextField } from "@decky/ui";
import { ReactNode, memo, useCallback, useEffect, useRef, useState } from "react";
import { FaDownload, FaStar, FaThumbsUp } from "react-icons/fa";
import { Loading, Note, scrollOnFocus } from "../ui";
import { NexusCard, NexusStatus, TabProps, TsCard, bridge, errText, startInstall, toast } from "../shared";
import { Item, NEXUS_SORTS, Source, TS_SORTS, compact, hideBroken, itemName } from "./common";
import { Details } from "./Details";
import { NexusLogin } from "./NexusLogin";

// ---------- module-level memory (survives tab switches) ----------

/** What the site picker shows: a mod site, or "Other sites" (the Downloads tab). */
type View = Source | "other";

/** Last view picked, per game. */
const sourceByGame = new Map<string, View>();

type Browse = {
  /** query|sort these results are for; null = nothing loaded yet. */
  loadedFor: string | null;
  query: string;
  sort: string;
  items: Item[];
  page: number;
  more: boolean;
};
const browseCache = new Map<string, Browse>();
const emptyBrowse = (src: Source): Browse => ({
  loadedFor: null, query: "", sort: src === "nexus" ? "downloads" : "most-downloaded", items: [], page: 0, more: false,
});

async function fetchPage(src: Source, game: string, query: string, sort: string, page: number) {
  if (src === "nexus") {
    const r = await bridge<{ mods: NexusCard[]; more: boolean }>("nexus_mods", { game, query, sort, page });
    return { more: r.more, items: r.mods.map((card): Item => ({ src: "nexus", key: `n${card.id}`, card })) };
  }
  const r = await bridge<{ mods: TsCard[]; more: boolean }>("ts_mods", { game, query, ordering: sort, page });
  return { more: r.more, items: r.mods.map((card): Item => ({ src: "ts", key: `t${card.namespace}/${card.name}`, card })) };
}

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

function GetMods({ game, profile, locked, onOpenDownloads }: GetModsProps) {
  const available: Record<Source, boolean> = { nexus: !!game.nexus_domain, ts: !!game.ts_community };
  const [view, setViewState] = useState<View>(() => {
    const kept = sourceByGame.get(game.name);
    if (kept) return kept;
    return available.ts ? "ts" : available.nexus ? "nexus" : "other";
  });
  const setView = (v: View) => {
    sourceByGame.set(game.name, v);
    setViewState(v);
  };
  // The mod site being browsed, if the picked view is one this game is on.
  const src: Source | null = view !== "other" && available[view] ? view : null;

  // Nexus account (the bridge caches nexus_status, so asking on every mount is cheap)
  const [nexus, setNexus] = useState<NexusStatus | null>(null);
  const [nexusError, setNexusError] = useState("");
  const loadNexus = (refresh: boolean) => {
    setNexusError("");
    if (refresh) setNexus(null);
    bridge<NexusStatus>("nexus_status", refresh ? { refresh: true } : {}).then(setNexus, (e) => setNexusError(errText(e)));
  };
  useEffect(() => {
    if (src === "nexus" && !nexus && !locked) loadNexus(false);
  }, [src, locked]);

  const logout = () => showModal(
    <ConfirmModal strTitle="Log out of Nexus Mods?"
      strDescription="Amethyst forgets your Nexus login. You can log in again any time."
      strOKButtonText="Log out" bDestructiveWarning
      onOK={async () => {
        try {
          await bridge("nexus_logout");
          setNexus({ logged_in: false });
          toast("Logged out of Nexus Mods");
        } catch (e) {
          toast(errText(e));
        }
      }} />);

  // Details view (inside the tab); remembers which card to refocus on return.
  const [open, setOpen] = useState<Item | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const notHere = (s: Source) => (available[s] ? "" : " (not for this game)");
  const header = (
    <Focusable className="amd-bar" flow-children="horizontal" style={{ flexWrap: "wrap" }}>
      <div style={{ minWidth: 260 }}>
        <Dropdown
          rgOptions={[
            { data: "nexus", label: `Site: Nexus Mods${notHere("nexus")}` },
            { data: "ts", label: `Site: Thunderstore${notHere("ts")}` },
            { data: "other", label: "Site: Other sites" },
          ]}
          selectedOption={view}
          onChange={(o) => { setOpen(null); setView(o.data); }}
        />
      </div>
      {src === "nexus" && nexus?.logged_in && (
        <>
          <span className="amd-sub">
            {nexus.name ?? "Logged in"} · <span className={nexus.premium ? "" : "amd-warn"}>{nexus.premium ? "Premium" : "Free account"}</span>
          </span>
          <DialogButton style={{ width: "auto", minWidth: 110 }} onClick={logout}>Log out</DialogButton>
        </>
      )}
      {locked && <span className="amd-warn">A deploy is running. Installs are paused.</span>}
      {isBG3(game.nexus_domain) && view !== "other" && (
        <span className="amd-sub" style={{ flexBasis: "100%", paddingLeft: 2 }}>
          mod.io mods for {game.name} are in the game's own Mod Manager (main menu).
        </span>
      )}
    </Focusable>
  );

  let body;
  if (view === "other") {
    body = <OtherSites game={game.name} bg3={isBG3(game.nexus_domain)} onOpenDownloads={onOpenDownloads} />;
  } else if (!src) {
    body = <NotOnSite game={game.name} site={view} onOther={() => setView("other")}
      onSwitch={available.nexus ? () => setView("nexus") : available.ts ? () => setView("ts") : undefined}
      switchLabel={available.nexus ? "Browse Nexus Mods" : "Browse Thunderstore"} />;
  } else if (src === "nexus" && !nexus?.logged_in) {
    body = nexusError ? (
      <Focusable flow-children="vertical">
        <Note>{nexusError}</Note>
        <DialogButton style={{ width: "auto", alignSelf: "flex-start", marginLeft: 14 }}
          onClick={() => loadNexus(true)}>Retry</DialogButton>
      </Focusable>
    ) : !nexus ? (
      <Loading text={locked ? "Waiting for the deploy to finish…" : "Checking your Nexus Mods account…"} />
    ) : (
      <NexusLogin status={nexus} onStatus={setNexus} />
    );
  } else if (open) {
    body = (
      <Details item={open} game={game.name} profile={profile} locked={locked} premium={!!nexus?.premium}
        onBack={() => setOpen(null)} />
    );
  } else {
    body = (
      <Results key={src} src={src} game={game.name} profile={profile} locked={locked}
        focusKey={focusKey}
        onOpen={(it) => { setFocusKey(it.key); setOpen(it); }} />
    );
  }

  return (
    <Focusable flow-children="vertical" style={{ display: "flex", flexDirection: "column" }}>
      {header}
      {body}
    </Focusable>
  );
}

// ---------- search bar + result cards ----------

function Results({ src, game, profile, locked, focusKey, onOpen }: {
  src: Source; game: string; profile: string; locked: boolean;
  focusKey: string | null;
  onOpen: (it: Item) => void;
}) {
  const cacheKey = `${game}|${src}`;
  const sortOptions = src === "nexus" ? NEXUS_SORTS : TS_SORTS;
  const [b, setB] = useState<Browse>(() => browseCache.get(cacheKey) ?? emptyBrowse(src));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const req = useRef(0);
  const cards = useRef(new Map<string, HTMLDivElement>());
  /** Card to focus after the next render: a key (back from details) or an index (first card of a new page). */
  const [focusNext, setFocusNext] = useState<string | number | null>(focusKey);

  useEffect(() => { browseCache.set(cacheKey, b); }, [b]);

  const want = `${b.query}|${b.sort}`;
  const load = async (page: number) => {
    const id = ++req.current;
    setLoading(true);
    setError("");
    try {
      const r = await fetchPage(src, game, b.query, b.sort, page);
      if (id !== req.current) return;
      setB((cur) => {
        if (!page) return { ...cur, loadedFor: want, page, more: r.more, items: r.items };
        const seen = new Set(cur.items.map((i) => i.key));
        return { ...cur, loadedFor: want, page, more: r.more, items: [...cur.items, ...r.items.filter((i) => !seen.has(i.key))] };
      });
      // Load more: focus the first new card, right below where focus was.
      if (page) setFocusNext(b.items.length);
    } catch (e) {
      if (id === req.current) setError(errText(e));
    } finally {
      if (id === req.current) setLoading(false);
    }
  };

  // New query or sort: back to page 0. Bridge calls are refused during a deploy, so wait for it.
  useEffect(() => {
    if (b.loadedFor !== want && !locked) load(0);
  }, [want, locked]);

  useEffect(() => {
    if (focusNext === null) return;
    const key = typeof focusNext === "number" ? b.items[focusNext]?.key : focusNext;
    const el = key ? cards.current.get(key) : undefined;
    if (el) {
      el.focus();
      el.scrollIntoView?.({ block: "center" });
    }
    setFocusNext(null);
  }, [focusNext, b.items]);

  const search = (query: string, sort = b.sort) => {
    if (query === b.query && sort === b.sort) return;
    setB((cur) => ({ ...cur, query, sort, loadedFor: null, items: [], page: 0, more: false }));
  };

  // Stable callbacks, so typing or loading doesn't re-render every card.
  const register = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) cards.current.set(key, el); else cards.current.delete(key);
  }, []);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const open = useCallback((it: Item) => onOpenRef.current(it), []);
  const quickInstall = useCallback((it: Item) => {
    if (it.src !== "ts" || locked) return;
    startInstall("ts_install", { game, profile, namespace: it.card.namespace, name: it.card.name }, itemName(it));
  }, [game, profile, locked]);

  return (
    <Focusable flow-children="vertical" style={{ display: "flex", flexDirection: "column" }}>
      <SearchBox query={b.query} onSearch={(q) => search(q)}>
        <div style={{ minWidth: 200 }}>
          <Dropdown rgOptions={sortOptions} selectedOption={b.sort} onChange={(o) => search(b.query, o.data)} />
        </div>
      </SearchBox>

      {error ? (
        <Focusable flow-children="vertical">
          <Note>{error}</Note>
          <DialogButton style={{ width: "auto", alignSelf: "flex-start", marginLeft: 14 }}
            onClick={() => load(b.loadedFor === want ? b.page + 1 : 0)}>Retry</DialogButton>
        </Focusable>
      ) : null}

      {!b.items.length ? (
        loading || (b.loadedFor !== want && !error) ? (
          <Loading text={locked ? "Waiting for the deploy to finish…"
            : `Searching ${src === "nexus" ? "Nexus Mods" : "Thunderstore"}…`} />
        ) : !error ? <Note>No mods found.</Note> : null
      ) : (
        <Focusable flow-children="vertical" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {b.items.map((it) => (
            <ResultCard key={it.key} it={it} preferred={it.key === focusKey} locked={locked}
              register={register} onOpen={open} onQuickInstall={quickInstall} />
          ))}
          {b.more && (
            <DialogButton style={{ width: "auto", alignSelf: "center", minWidth: 220, margin: "8px 0 16px" }}
              disabled={loading} onClick={() => load(b.page + 1)}>
              {loading ? "Loading…" : "Load more"}
            </DialogButton>
          )}
        </Focusable>
      )}
    </Focusable>
  );
}

/** Search field, the bar's middle controls (children) and Clear. Owns the typed
 * text, so typing re-renders only this bar. */
function SearchBox({ query, onSearch, children }: { query: string; onSearch: (q: string) => void; children: ReactNode }) {
  const [text, setText] = useState(query);
  // The hint sits under the row, not under the field, so the field, sort
  // dropdown and Clear button line up.
  return (
    <>
      <Focusable className="amd-bar" flow-children="horizontal" style={{ paddingBottom: 2 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <TextField
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSearch(text.trim()); }}
            onBlur={() => onSearch(text.trim())}
          />
        </div>
        {children}
        <DialogButton style={{ width: "auto", minWidth: 100 }} disabled={!text && !query}
          onClick={() => { setText(""); onSearch(""); }}>Clear</DialogButton>
      </Focusable>
      <div className="amd-sub" style={{ padding: "0 0 8px 2px" }}>
        {query ? `Showing results for "${query}"` : "Search (A opens the keyboard). Empty shows top mods."}
      </div>
    </>
  );
}

const ResultCard = memo(function ResultCard({ it, preferred, locked, register, onOpen, onQuickInstall }: {
  it: Item; preferred: boolean; locked: boolean;
  register: (key: string, el: HTMLDivElement | null) => void;
  onOpen: (it: Item) => void;
  onQuickInstall: (it: Item) => void;
}) {
  const ref = useCallback((el: HTMLDivElement | null) => register(it.key, el), [register, it.key]);
  const quick = it.src === "ts" && !locked;
  return (
    <Focusable
      ref={ref}
      className="amd-card"
      focusClassName="amd-focus"
      preferredFocus={preferred}
      onFocus={scrollOnFocus}
      onActivate={() => onOpen(it)}
      onOKActionDescription="Details"
      onSecondaryButton={quick ? () => onQuickInstall(it) : undefined}
      onSecondaryActionDescription={quick ? "Install latest" : undefined}
    >
      <CardBody it={it} />
    </Focusable>
  );
});

function CardBody({ it }: { it: Item }) {
  const c = it.card;
  const author = it.src === "ts" ? c.author || it.card.namespace : c.author;
  const ell = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
  return (
    <>
      {c.picture ? <img className="amd-thumb" src={c.picture} onError={hideBroken} loading="lazy" />
        : <div className="amd-thumb" />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...ell, fontSize: 15 }}>
          {itemName(it)} <span className="amd-sub">by {author}</span>
        </div>
        <div className="amd-sub" style={ell}>{c.summary}</div>
      </div>
      <div className="amd-sub" style={{ whiteSpace: "nowrap", textAlign: "right", display: "flex", flexDirection: "column", gap: 2 }}>
        <span><FaDownload /> {compact(c.downloads)}</span>
        {it.src === "nexus"
          ? <span><FaThumbsUp /> {compact(it.card.endorsements)}</span>
          : <span><FaStar /> {compact(it.card.rating)}</span>}
      </div>
    </>
  );
}

const SITE_NAMES: Record<Source, string> = { nexus: "Nexus Mods", ts: "Thunderstore" };

/** The picked site doesn't have this game: say so instead of showing nothing. */
function NotOnSite({ game, site, onOther, onSwitch, switchLabel }: {
  game: string; site: Source; onOther: () => void; onSwitch?: () => void; switchLabel: string;
}) {
  const why = site === "ts"
    ? "Thunderstore only has mods for some games, mostly ones modded with BepInEx (Valheim, Lethal Company, Risk of Rain 2, Subnautica and others)."
    : "Amethyst doesn't know a Nexus Mods page for this game.";
  return (
    <Focusable flow-children="vertical" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 14px" }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{game} isn't on {SITE_NAMES[site]}</div>
      <div className="amd-sub" style={{ whiteSpace: "normal" }}>{why}</div>
      <Focusable flow-children="horizontal" style={{ display: "flex", gap: 10 }}>
        {onSwitch && <DialogButton style={{ width: "auto", minWidth: 200 }} onClick={onSwitch}>{switchLabel}</DialogButton>}
        <DialogButton style={{ width: "auto", minWidth: 200 }} onClick={onOther}>Other sites</DialogButton>
      </Focusable>
    </Focusable>
  );
}

/** Mods from anywhere else go through the Downloads tab. */
function OtherSites({ game, bg3, onOpenDownloads }: { game: string; bg3: boolean; onOpenDownloads?: () => void }) {
  return (
    <Focusable flow-children="vertical" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 14px" }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>Mods from other sites</div>
      <div className="amd-sub" style={{ whiteSpace: "normal", fontSize: 14, lineHeight: 1.5 }}>
        Any mod archive (.zip, .7z, .rar) can be installed, wherever it comes from: ModDB, GitHub, a mod's own
        page and so on. Save it to your Downloads folder, from Steam's browser or by copying it over, then open
        the Downloads tab and press A on it. Installer options (FOMOD) show up here as usual.
      </div>
      {bg3 && (
        <div className="amd-warn" style={{ whiteSpace: "normal", fontSize: 14, lineHeight: 1.5 }}>
          {game}: mods from mod.io, the game's official mod site, are installed from the game itself.
          Start the game and open Mod Manager from the main menu. They work alongside the mods installed here.
        </div>
      )}
      {onOpenDownloads && (
        <DialogButton style={{ width: "auto", alignSelf: "flex-start", minWidth: 220 }} onClick={onOpenDownloads}>
          Open the Downloads tab
        </DialogButton>
      )}
    </Focusable>
  );
}
