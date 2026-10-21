import { DialogButton, Dropdown, Focusable, TextField } from "@decky/ui";
import { ReactNode, memo, useCallback, useEffect, useRef, useState } from "react";
import { FaDownload, FaStar, FaThumbsUp } from "react-icons/fa";
import { Loading, Note, RetryNote, scrollOnFocus } from "../ui";
import { NexusCard, TsCard, bridge, errText, startInstall } from "../shared";
import { Item, NEXUS_SORTS, SITE_NAMES, Source, TS_SORTS, compact, hideBroken, itemName } from "./common";

type Browse = {
  /** query|sort these results are for; null = nothing loaded yet. */
  loadedFor: string | null;
  query: string;
  sort: string;
  items: Item[];
  page: number;
  more: boolean;
};

/** Search results per game and site, so they survive tab switches and the details view. */
const browseCache = new Map<string, Browse>();

const emptyBrowse = (src: Source): Browse => ({
  loadedFor: null,
  query: "",
  sort: src === "nexus" ? "downloads" : "most-downloaded",
  items: [],
  page: 0,
  more: false,
});

async function fetchPage(src: Source, game: string, query: string, sort: string, page: number) {
  if (src === "nexus") {
    const reply = await bridge<{ mods: NexusCard[]; more: boolean }>("nexus_mods", { game, query, sort, page });
    return { more: reply.more, items: reply.mods.map((card): Item => ({ src: "nexus", key: `n${card.id}`, card })) };
  }
  const reply = await bridge<{ mods: TsCard[]; more: boolean }>("ts_mods", { game, query, ordering: sort, page });
  return { more: reply.more, items: reply.mods.map((card): Item => ({ src: "ts", key: `t${card.namespace}/${card.name}`, card })) };
}

/** Add a later page's items, skipping any the site already sent (lists can shift between pages). */
function appendNew(items: Item[], more: Item[]): Item[] {
  const seen = new Set(items.map((item) => item.key));
  return [...items, ...more.filter((item) => !seen.has(item.key))];
}

/**
 * The search state for one site: query, sort and the pages loaded so far.
 * `onPageAdded` gets the index of the first new item when a later page arrives.
 */
function useBrowse(src: Source, game: string, locked: boolean, onPageAdded: (firstNew: number) => void) {
  const cacheKey = `${game}|${src}`;
  const [browse, setBrowse] = useState<Browse>(() => browseCache.get(cacheKey) ?? emptyBrowse(src));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Only the newest request may update state; an older reply is dropped.
  const latestRequest = useRef(0);

  useEffect(() => {
    browseCache.set(cacheKey, browse);
  }, [cacheKey, browse]);

  const want = `${browse.query}|${browse.sort}`;
  const loadPage = async (page: number) => {
    const request = ++latestRequest.current;
    setLoading(true);
    setError("");
    try {
      const result = await fetchPage(src, game, browse.query, browse.sort, page);
      if (request !== latestRequest.current) return;
      setBrowse((current) => ({
        ...current,
        loadedFor: want,
        page,
        more: result.more,
        items: page ? appendNew(current.items, result.items) : result.items,
      }));
      if (page) onPageAdded(browse.items.length);
    } catch (e) {
      if (request === latestRequest.current) setError(errText(e));
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  };
  // loadPage is new every render; the effect below reads it through a ref so it only re-runs for a new search.
  const loadPageRef = useRef(loadPage);
  loadPageRef.current = loadPage;

  // New query or sort: back to page 0. Bridge calls are refused during a deploy, so wait for it.
  useEffect(() => {
    if (browse.loadedFor !== want && !locked) loadPageRef.current(0);
  }, [browse.loadedFor, want, locked]);

  const search = (query: string, sort = browse.sort) => {
    if (query === browse.query && sort === browse.sort) return;
    setBrowse((current) => ({ ...current, query, sort, loadedFor: null, items: [], page: 0, more: false }));
  };
  /** Retry after an error: the next page if this search loaded before, else page 0. */
  const retry = () => loadPage(browse.loadedFor === want ? browse.page + 1 : 0);
  const pending = browse.loadedFor !== want;

  return { browse, loading, error, pending, loadPage, search, retry };
}

/** What focus moves to after the next render: a card's key (back from details) or an index (first card of a new page). */
type FocusTarget = string | number | null;

/** Remembers each card's element, and focuses `target` once it has rendered. */
function useCardFocus(items: Item[], target: FocusTarget, setTarget: (target: FocusTarget) => void) {
  const cards = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (target === null) return;
    const key = typeof target === "number" ? items[target]?.key : target;
    const card = key ? cards.current.get(key) : undefined;
    if (card) {
      card.focus();
      card.scrollIntoView?.({ block: "center" });
    }
    setTarget(null);
  }, [target, items, setTarget]);

  // Stable, so loading or typing doesn't re-render every card.
  return useCallback((key: string, card: HTMLDivElement | null) => {
    if (card) {
      cards.current.set(key, card);
    } else {
      cards.current.delete(key);
    }
  }, []);
}

/** Search bar and result cards for one site. */
export function Results({ src, game, profile, locked, focusKey, onOpen }: {
  src: Source; game: string; profile: string; locked: boolean;
  focusKey: string | null;
  onOpen: (item: Item) => void;
}) {
  const [focusTarget, setFocusTarget] = useState<FocusTarget>(focusKey);
  // Load more: focus the first new card, right below where focus was.
  const { browse, loading, error, pending, loadPage, search, retry } = useBrowse(src, game, locked, setFocusTarget);
  const register = useCardFocus(browse.items, focusTarget, setFocusTarget);

  // Stable callbacks, so typing or loading doesn't re-render every card.
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const open = useCallback((item: Item) => onOpenRef.current(item), []);
  const quickInstall = useCallback((item: Item) => {
    if (item.src !== "ts" || locked) return;
    startInstall("ts_install", { game, profile, namespace: item.card.namespace, name: item.card.name }, itemName(item));
  }, [game, profile, locked]);

  const list = browse.items.length ? (
    <Focusable flow-children="vertical" className="amd-list">
      {browse.items.map((item) => (
        <ResultCard key={item.key} item={item} preferred={item.key === focusKey} locked={locked}
          register={register} onOpen={open} onQuickInstall={quickInstall} />
      ))}
      {browse.more && (
        <DialogButton className="amd-button-auto amd-min-220 amd-load-more"
          disabled={loading} onClick={() => loadPage(browse.page + 1)}>
          {loading ? "Loading…" : "Load more"}
        </DialogButton>
      )}
    </Focusable>
  ) : <NoResults src={src} locked={locked} searching={loading || (pending && !error)} error={error} />;

  return (
    <Focusable flow-children="vertical" className="amd-stack">
      <SearchBox query={browse.query} onSearch={(query) => search(query)}>
        <div className="amd-min-200">
          <Dropdown rgOptions={src === "nexus" ? NEXUS_SORTS : TS_SORTS} selectedOption={browse.sort}
            onChange={(option) => search(browse.query, option.data)} />
        </div>
      </SearchBox>
      {error ? <RetryNote error={error} onRetry={retry} /> : null}
      {list}
    </Focusable>
  );
}

/** No cards yet: searching, nothing found, or nothing (the error above says why). */
function NoResults({ src, locked, searching, error }: { src: Source; locked: boolean; searching: boolean; error: string }) {
  if (searching) {
    return <Loading text={locked ? "Waiting for the deploy to finish…" : `Searching ${SITE_NAMES[src]}…`} />;
  }
  if (error) return null;
  return <Note>No mods found.</Note>;
}

/** Search field, the bar's middle controls (children) and Clear. Owns the typed
 * text, so typing re-renders only this bar. */
function SearchBox({ query, onSearch, children }: { query: string; onSearch: (query: string) => void; children: ReactNode }) {
  const [text, setText] = useState(query);
  const clear = () => {
    setText("");
    onSearch("");
  };
  // The hint sits under the row, not under the field, so the field, sort
  // dropdown and Clear button line up.
  return (
    <>
      <Focusable className="amd-bar amd-search-bar" flow-children="horizontal">
        <div className="amd-fill amd-min-200">
          <TextField
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSearch(text.trim());
            }}
            onBlur={() => onSearch(text.trim())}
          />
        </div>
        {children}
        <DialogButton className="amd-button-auto amd-min-100" disabled={!text && !query} onClick={clear}>Clear</DialogButton>
      </Focusable>
      <div className="amd-sub amd-search-hint">
        {query ? `Showing results for "${query}"` : "Search (A opens the keyboard). Empty shows top mods."}
      </div>
    </>
  );
}

const ResultCard = memo(function ResultCard({ item, preferred, locked, register, onOpen, onQuickInstall }: {
  item: Item; preferred: boolean; locked: boolean;
  register: (key: string, card: HTMLDivElement | null) => void;
  onOpen: (item: Item) => void;
  onQuickInstall: (item: Item) => void;
}) {
  const ref = useCallback((card: HTMLDivElement | null) => register(item.key, card), [register, item.key]);
  // X installs the latest version straight from the list; only Thunderstore has a single "latest".
  const quick = item.src === "ts" && !locked;
  return (
    <Focusable
      ref={ref}
      className="amd-card"
      focusClassName="amd-focus"
      preferredFocus={preferred}
      onFocus={scrollOnFocus}
      onActivate={() => onOpen(item)}
      onOKActionDescription="Details"
      onSecondaryButton={quick ? () => onQuickInstall(item) : undefined}
      onSecondaryActionDescription={quick ? "Install latest" : undefined}
    >
      <CardBody item={item} />
    </Focusable>
  );
});

function CardBody({ item }: { item: Item }) {
  const card = item.card;
  const author = item.src === "ts" ? card.author || item.card.namespace : card.author;
  return (
    <>
      {card.picture
        ? <img className="amd-thumb" src={card.picture} onError={hideBroken} loading="lazy" />
        : <div className="amd-thumb" />}
      <div className="amd-grow">
        <div className="amd-ellipsis amd-card-title">
          {itemName(item)} <span className="amd-sub">by {author}</span>
        </div>
        <div className="amd-sub amd-ellipsis">{card.summary}</div>
      </div>
      <div className="amd-sub amd-card-stats">
        <span><FaDownload /> {compact(card.downloads)}</span>
        {item.src === "nexus"
          ? <span><FaThumbsUp /> {compact(item.card.endorsements)}</span>
          : <span><FaStar /> {compact(item.card.rating)}</span>}
      </div>
    </>
  );
}
