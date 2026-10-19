import { ConfirmModal, DialogButton, Dropdown, Focusable, showModal, TextField } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import { FaDownload, FaStar, FaThumbsUp } from "react-icons/fa";
import { Loading, Note } from "../ui";
import { NexusCard, NexusStatus, TabProps, TsCard, bridge, errText, toast } from "../shared";
import {
  Item, NEXUS_SORTS, Source, TS_SORTS, compact, hideBroken, itemName, scrollOnFocus,
} from "./common";
import { Details, startInstall } from "./Details";
import { NexusLogin } from "./NexusLogin";

// ---------- module-level memory (survives tab switches) ----------

/** Last source picked, per game. */
const sourceByGame = new Map<string, Source>();
/** Nexus account status, shared by every game (one account). */
let nexusCache: NexusStatus | null = null;

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

/** Browse, search and install from Nexus Mods (Premium) and Thunderstore. */
export function GetModsTab(props: TabProps) {
  // Remount per game so every piece of state starts fresh.
  return <GetMods key={props.game.name} {...props} />;
}

function GetMods({ game, profile, locked }: TabProps) {
  const sources: Source[] = [...(game.ts_community ? ["ts" as const] : []), ...(game.nexus_domain ? ["nexus" as const] : [])];
  const [src, setSrcState] = useState<Source>(() => {
    const kept = sourceByGame.get(game.name);
    return kept && sources.includes(kept) ? kept : sources[0] ?? "nexus";
  });
  const setSrc = (s: Source) => {
    sourceByGame.set(game.name, s);
    setSrcState(s);
  };

  // Nexus account
  const [nexus, setNexusState] = useState<NexusStatus | null>(nexusCache);
  const [nexusError, setNexusError] = useState("");
  const setNexus = (s: NexusStatus) => {
    nexusCache = s;
    setNexusState(s);
  };
  const loadNexus = (refresh: boolean) => {
    setNexusError("");
    if (refresh) setNexusState(null);
    bridge<NexusStatus>("nexus_status", refresh ? { refresh: true } : {}).then(setNexus, (e) => setNexusError(errText(e)));
  };
  useEffect(() => {
    if (src === "nexus" && !nexus && !locked) loadNexus(false);
  }, [src, locked]);

  const logout = () => showModal(
    <ConfirmModal strTitle="Log out of Nexus Mods?"
      strDescription="Amethyst forgets your API key. You can log in again with the QR code."
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

  const sortOptions = src === "nexus" ? NEXUS_SORTS : TS_SORTS;

  const header = (
    <Focusable className="amd-bar" flow-children="horizontal" style={{ flexWrap: "wrap" }}>
      {sources.length > 1 && (
        <div style={{ minWidth: 220 }}>
          <Dropdown
            rgOptions={[
              { data: "ts", label: "Source: Thunderstore" },
              { data: "nexus", label: "Source: Nexus Mods" },
            ]}
            selectedOption={src}
            onChange={(o) => { setOpen(null); setSrc(o.data); }}
          />
        </div>
      )}
      {sources.length === 1 && (
        <span style={{ fontWeight: 600, paddingLeft: 14 }}>{src === "nexus" ? "Nexus Mods" : "Thunderstore"}</span>
      )}
      {src === "nexus" && nexus?.logged_in && (
        <>
          <span className="amd-sub">
            {nexus.name ?? "Logged in"} · <span className={nexus.premium ? "" : "amd-warn"}>{nexus.premium ? "Premium" : "Free account"}</span>
          </span>
          <DialogButton style={{ width: "auto", minWidth: 110 }} onClick={logout}>Log out</DialogButton>
        </>
      )}
      {locked && <span className="amd-warn">A deploy is running. Installs are paused.</span>}
    </Focusable>
  );

  let body;
  if (src === "nexus" && !nexus?.logged_in) {
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
        sortOptions={sortOptions} focusKey={focusKey}
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

function Results({ src, game, profile, locked, sortOptions, focusKey, onOpen }: {
  src: Source; game: string; profile: string; locked: boolean;
  sortOptions: { data: string; label: string }[];
  focusKey: string | null;
  onOpen: (it: Item) => void;
}) {
  const cacheKey = `${game}|${src}`;
  const [b, setB] = useState<Browse>(() => browseCache.get(cacheKey) ?? emptyBrowse(src));
  const [text, setText] = useState(b.query);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const req = useRef(0);
  const cards = useRef(new Map<string, HTMLDivElement>());
  /** Card to focus after the next render (load more, or back from details). */
  const [focusNext, setFocusNext] = useState<string | null>(focusKey);

  const itemsRef = useRef(b.items);
  itemsRef.current = b.items;
  useEffect(() => { browseCache.set(cacheKey, b); }, [b]);

  const want = `${b.query}|${b.sort}`;
  const load = async (page: number) => {
    const id = ++req.current;
    setLoading(true);
    setError("");
    try {
      const r = await fetchPage(src, game, b.query, b.sort, page);
      if (id !== req.current) return;
      const seen = new Set(page ? itemsRef.current.map((i) => i.key) : []);
      const fresh = r.items.filter((i) => !seen.has(i.key));
      setB((cur) => ({ ...cur, loadedFor: want, page, more: r.more, items: page ? [...cur.items, ...fresh] : r.items }));
      // Load more: focus the first new card, right below where focus was.
      if (page && fresh.length) setFocusNext(fresh[0].key);
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
    if (!focusNext) return;
    const el = cards.current.get(focusNext);
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

  const quickInstall = (it: Item) => {
    if (it.src !== "ts" || locked) return;
    startInstall("ts_install", { game, profile, namespace: it.card.namespace, name: it.card.name }, itemName(it));
  };

  return (
    <Focusable flow-children="vertical" style={{ display: "flex", flexDirection: "column" }}>
      <Focusable className="amd-bar" flow-children="horizontal">
        <div style={{ flex: 1, minWidth: 200 }}>
          <TextField
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") search(text.trim()); }}
            onBlur={() => search(text.trim())}
            description={b.query ? `Showing results for "${b.query}"` : "Search (A opens the keyboard). Empty shows top mods."}
          />
        </div>
        <div style={{ minWidth: 200 }}>
          <Dropdown rgOptions={sortOptions} selectedOption={b.sort} onChange={(o) => search(b.query, o.data)} />
        </div>
        <DialogButton style={{ width: "auto", minWidth: 100 }} disabled={!text && !b.query}
          onClick={() => { setText(""); search(""); }}>Clear</DialogButton>
      </Focusable>

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
            <Focusable
              key={it.key}
              ref={(el: HTMLDivElement | null) => { if (el) cards.current.set(it.key, el); else cards.current.delete(it.key); }}
              className="amd-card"
              focusClassName="amd-focus"
              preferredFocus={it.key === focusKey}
              onFocus={scrollOnFocus}
              onActivate={() => onOpen(it)}
              onOKActionDescription="Details"
              onSecondaryButton={it.src === "ts" && !locked ? () => quickInstall(it) : undefined}
              onSecondaryActionDescription={it.src === "ts" && !locked ? "Install latest" : undefined}
            >
              <CardBody it={it} />
            </Focusable>
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
