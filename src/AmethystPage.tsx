import {
  ConfirmModal,
  DialogButton,
  Dropdown,
  Focusable,
  showModal,
  Spinner,
  Tabs,
  TextField,
} from "@decky/ui";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { FaCheckSquare, FaExclamationTriangle, FaLock, FaRegSquare } from "react-icons/fa";
import { ReorderList } from "./ReorderList";
import {
  BridgeGame, Mod, PluginRow, bridge, errText, resolveAppId, runApp, selection,
  startGameJob, toast, useJob,
} from "./shared";

const CSS = `
.amd-page { padding: 48px 24px 0; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; }
.amd-header { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding-bottom: 8px; }
.amd-header .amd-pick { min-width: 220px; }
.amd-status { font-size: 12px; opacity: 0.7; padding-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.amd-tabs { flex: 1; min-height: 0; }
.amd-row { display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-radius: 4px; font-size: 14px; }
.amd-row.amd-focus { background: rgba(255,255,255,0.12); }
.amd-row.amd-sep { margin-top: 10px; font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.75; border-bottom: 1px solid rgba(255,255,255,0.15); border-radius: 0; }
.amd-row.amd-dim { opacity: 0.45; }
.amd-row.amd-grabbed { background: rgba(26,159,255,0.35); outline: 2px solid #1a9fff; }
.amd-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.amd-tag { font-size: 11px; opacity: 0.6; }
.amd-warn { font-size: 12px; color: #ffc82c; }
.amd-err { font-size: 12px; color: #ff6b6b; }
.amd-note { padding: 12px 14px; font-size: 13px; opacity: 0.85; }
.amd-bar { display: flex; gap: 12px; align-items: center; padding: 4px 0 10px; }
`;

const Check = ({ on }: { on: boolean }) => (on ? <FaCheckSquare /> : <FaRegSquare style={{ opacity: 0.6 }} />);

const Note = ({ children }: { children: ReactNode }) => <div className="amd-note">{children}</div>;

const Loading = ({ text }: { text: string }) => (
  <div className="amd-note" style={{ display: "flex", gap: 8, alignItems: "center" }}>
    <Spinner style={{ height: 20 }} /> {text}
  </div>
);

/**
 * Rows loaded from the bridge with optimistic edits. `save` applies a local
 * change at once, runs the bridge call, then takes the bridge's rows as truth
 * (or puts the old rows back and shows the error).
 */
function useRows<T>(load: (() => Promise<T[]>) | null, deps: unknown[]) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const rowsRef = useRef<T[] | null>(null);
  rowsRef.current = rows;

  useEffect(() => {
    if (!load) return;
    let live = true;
    setRows(null);
    setError("");
    load().then((r) => live && setRows(r), (e) => live && setError(errText(e)));
    return () => { live = false; };
  }, deps);

  const save = async (optimistic: T[] | null, call: () => Promise<T[]>) => {
    const before = rowsRef.current;
    if (optimistic) setRows(optimistic);
    setSaving(true);
    try {
      setRows(await call());
    } catch (e) {
      setRows(before);
      toast(errText(e));
    } finally {
      setSaving(false);
    }
  };
  return { rows, setRows, error, saving, save };
}

// ---------- Mods ----------

function ModsTab({ game, profile, locked, reload }: { game: string; profile: string; locked: boolean; reload: number }) {
  const { rows, error, saving, save } = useRows<Mod>(
    () => bridge<Mod[]>("mods", { game, profile }), [game, profile, reload]);

  if (error) return <Note>{error}</Note>;
  if (!rows) return <Loading text="Reading mod list…" />;
  if (!rows.length) return <Note>No mods in this profile yet. Installing mods comes in a later update; use Amethyst in Desktop Mode for now.</Note>;

  const mods = rows.filter((m) => !m.separator);
  return (
    <>
      <div className="amd-status">
        {mods.filter((m) => m.enabled).length} of {mods.length} enabled · top of the list wins conflicts
        {saving && " · saving…"}
      </div>
      <ReorderList<Mod>
        items={rows}
        keyOf={(m) => m.name}
        disabled={locked || saving}
        rowClass={(m) => (m.separator ? "amd-sep" : m.enabled ? "" : "amd-dim")}
        canToggle={(m) => !m.separator && !m.locked}
        canMove={() => true}
        toggleLabel={(m) => (m.enabled ? "Disable" : "Enable")}
        onToggle={(m) => save(
          rows.map((x) => (x.name === m.name ? { ...x, enabled: !m.enabled } : x)),
          () => bridge<Mod[]>("set_mod_enabled", { game, profile, name: m.name, enabled: !m.enabled }))}
        onMove={(m, to, order) => save(order,
          () => bridge<Mod[]>("move_mod", { game, profile, name: m.name, to_index: to }))}
        renderRow={(m) => m.separator ? (
          <span className="amd-name">{m.label}</span>
        ) : (
          <>
            <Check on={m.enabled} />
            <span className="amd-name">{m.label}</span>
            {m.locked && <FaLock className="amd-tag" />}
          </>
        )}
      />
    </>
  );
}

// ---------- Plugins ----------

type LootResult = { moved: number; warnings: string[]; plugins: PluginRow[]; log: string[] };

function PluginsTab({ game, profile, loot, locked, reload }: {
  game: string; profile: string; loot: boolean; locked: boolean; reload: number;
}) {
  const { rows, error, saving, save } = useRows<PluginRow>(
    () => bridge<PluginRow[]>("plugins", { game, profile }), [game, profile, reload]);
  const [warnings, setWarnings] = useState<string[]>([]);

  const sort = () => save(null, async () => {
    const r = await bridge<LootResult>("loot_sort", { game, profile });
    setWarnings(r.warnings);
    toast(r.moved ? `LOOT moved ${r.moved} plugin${r.moved === 1 ? "" : "s"}` : "LOOT: order already correct");
    return r.plugins;
  });

  if (error) return <Note>{error}</Note>;
  if (!rows) return <Loading text="Reading plugins…" />;

  const busy = locked || saving;
  return (
    <>
      <Focusable className="amd-bar" flow-children="horizontal">
        {loot && (
          <DialogButton style={{ width: "auto", minWidth: 200 }} disabled={busy} onClick={sort}>
            {saving ? "Working…" : "Sort with LOOT"}
          </DialogButton>
        )}
        <span className="amd-status" style={{ paddingBottom: 0 }}>
          {rows.filter((r) => r.enabled).length} of {rows.length} active · load order, top loads first
        </span>
      </Focusable>
      {warnings.map((w, i) => <div key={i} className="amd-warn" style={{ padding: "0 14px 6px" }}>{w}</div>)}
      {!rows.length ? <Note>No plugins found. Enable some mods first.</Note> : (
        <ReorderList<PluginRow>
          items={rows}
          keyOf={(r) => r.name}
          disabled={busy}
          rowClass={(r) => (r.vanilla || !r.enabled ? "amd-dim" : "")}
          canToggle={(r) => !r.vanilla}
          canMove={(r) => !r.vanilla}
          toggleLabel={(r) => (r.enabled ? "Disable" : "Enable")}
          onToggle={(r) => save(
            rows.map((x) => (x.name === r.name ? { ...x, enabled: !r.enabled } : x)),
            () => bridge<PluginRow[]>("set_plugin_enabled", { game, profile, name: r.name, enabled: !r.enabled }))}
          onMove={(r, to, order) => save(order,
            () => bridge<PluginRow[]>("move_plugin", { game, profile, name: r.name, to_index: to }))}
          renderRow={(r) => (
            <>
              {r.vanilla ? <FaLock style={{ opacity: 0.6 }} /> : <Check on={r.enabled} />}
              <span className="amd-name">{r.name}</span>
              {r.missing_masters.length > 0 && (
                <span className="amd-err"><FaExclamationTriangle /> Missing: {r.missing_masters.join(", ")}</span>
              )}
              {r.late_masters.length > 0 && (
                <span className="amd-warn"><FaExclamationTriangle /> Loads before: {r.late_masters.join(", ")}</span>
              )}
              {r.master && <span className="amd-tag">ESM</span>}
              {r.light && <span className="amd-tag">ESL</span>}
            </>
          )}
        />
      )}
    </>
  );
}

// ---------- Setup ----------

function NewProfileModal({ game, closeModal, onCreated }: {
  game: string; closeModal?: () => void; onCreated: (name: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <ConfirmModal
      strTitle={`New profile for ${game}`}
      strOKButtonText="Create"
      bOKDisabled={!name.trim()}
      closeModal={closeModal}
      onOK={async () => {
        try {
          await bridge("create_profile", { game, name: name.trim() });
          toast(`Created profile ${name.trim()}`);
          onCreated(name.trim());
        } catch (e) {
          toast(errText(e));
        }
      }}
    >
      <TextField label="Profile name" focusOnMount value={name} onChange={(e) => setName(e.target.value)} />
    </ConfirmModal>
  );
}

export const askNewProfile = (game: string, onCreated: (name: string) => void) =>
  showModal(<NewProfileModal game={game} onCreated={onCreated} />);

type Detected = { name: string; path: string };
type Configured = { configured: boolean; path: string; prefix: string; needs_first_launch: boolean };

function SetupTab({ games, current, locked, reload, onConfigured, onProfileCreated }: {
  games: BridgeGame[]; current?: BridgeGame; locked: boolean; reload: number;
  onConfigured: (game: string) => void; onProfileCreated: (game: string, profile: string) => void;
}) {
  const { rows, error, setRows } = useRows<Detected>(() => bridge<Detected[]>("detect_installed"), [reload]);
  const [working, setWorking] = useState("");
  const [firstLaunch, setFirstLaunch] = useState<string[]>([]);

  const configure = async (d: Detected) => {
    setWorking(d.name);
    try {
      const r = await bridge<Configured>("configure_game", { game: d.name, path: d.path });
      setRows((rs) => (rs ?? []).filter((x) => x.name !== d.name));
      if (r.needs_first_launch) setFirstLaunch((f) => [...f, d.name]);
      toast(`${d.name} is set up`);
      onConfigured(d.name);
    } catch (e) {
      toast(errText(e));
    } finally {
      setWorking("");
    }
  };

  return (
    <Focusable flow-children="vertical" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {current && (
        <>
          <div className="amd-status">Profiles for {current.name}: {current.profiles.join(", ") || "none yet"}</div>
          <DialogButton style={{ width: "auto", alignSelf: "flex-start", minWidth: 240 }} disabled={locked}
            onClick={() => askNewProfile(current.name, (p) => onProfileCreated(current.name, p))}>
            New profile for {current.name}
          </DialogButton>
        </>
      )}

      {firstLaunch.map((name) => {
        const g = games.find((x) => x.name === name);
        const appId = g ? resolveAppId(g) : null;
        return (
          <Focusable key={name} className="amd-bar" flow-children="horizontal">
            <span className="amd-warn" style={{ flex: 1 }}>
              <FaExclamationTriangle /> Launch {name} once from Steam so it creates its Proton prefix, then set it up again here.
            </span>
            {appId && <DialogButton style={{ width: "auto" }} onClick={() => runApp(appId)}>Play now</DialogButton>}
          </Focusable>
        );
      })}

      <div className="amd-status" style={{ marginTop: 12 }}>Installed games that aren't set up in Amethyst yet</div>
      {error ? <Note>{error}</Note> : !rows ? <Loading text="Looking through your Steam libraries…" /> :
        !rows.length ? <Note>Nothing to set up. Every supported game Steam has installed is already set up.</Note> :
          rows.map((d) => (
            <Focusable key={d.name} className="amd-bar" flow-children="horizontal">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>{d.name}</div>
                <div className="amd-tag" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{d.path}</div>
              </div>
              <DialogButton style={{ width: "auto", minWidth: 140 }} disabled={locked || !!working}
                onClick={() => configure(d)}>
                {working === d.name ? "Setting up…" : "Set up"}
              </DialogButton>
            </Focusable>
          ))}
    </Focusable>
  );
}

// ---------- Page ----------

function pickProfile(g: BridgeGame, wanted?: string) {
  for (const p of [wanted, g.active_profile, g.deployed_profile]) {
    if (p && g.profiles.includes(p)) return p;
  }
  return g.profiles[0];
}

export function AmethystPage() {
  const [games, setGames] = useState<BridgeGame[] | null>(null);
  const [error, setError] = useState("");
  const [game, setGame] = useState<string | undefined>(selection.game);
  const [profile, setProfile] = useState<string | undefined>(selection.profile);
  const [tab, setTab] = useState("mods");
  const [reload, setReload] = useState(0);

  const loadGames = useCallback(async (want?: { game?: string; profile?: string }) => {
    setError("");
    try {
      const all = await bridge<BridgeGame[]>("list_games");
      setGames(all);
      const ready = all.filter((g) => g.configured);
      const g = ready.find((x) => x.name === (want?.game ?? selection.game)) ?? ready[0];
      setGame(g?.name);
      setProfile(g ? pickProfile(g, want?.profile ?? (g.name === selection.game ? selection.profile : undefined)) : undefined);
      if (!ready.length) setTab("setup");
    } catch (e) {
      setError(errText(e));
    }
  }, []);

  const [job, setJob] = useJob(() => {
    // Deploy state changed and the bridge was stopped for the job: reload everything.
    loadGames();
    setReload((n) => n + 1);
  });
  const busy = !!job.running;

  useEffect(() => { loadGames(); }, []);
  useEffect(() => {
    selection.game = game;
    selection.profile = profile;
  }, [game, profile]);

  const ready = (games ?? []).filter((g) => g.configured);
  const current = ready.find((g) => g.name === game);
  const appId = current ? resolveAppId(current) : null;

  const deploy = async (launch: boolean) => {
    if (!current || !profile) return;
    setJob({ action: "deploy", running: true, log: [] });
    const err = await startGameJob("deploy", current, profile, launch ? appId : null);
    if (err) setJob({ running: false, ok: false, log: [err] });
  };

  let body: ReactNode;
  if (error && !games) {
    body = (
      <Focusable flow-children="vertical">
        <Note>{error}</Note>
        <DialogButton style={{ width: "auto", alignSelf: "flex-start" }} onClick={() => loadGames()}>Retry</DialogButton>
      </Focusable>
    );
  } else if (!games) {
    body = <Loading text="Starting Amethyst… (the first time takes a few seconds)" />;
  } else {
    const ctx = current && profile ? { game: current.name, profile, locked: busy, reload } : null;
    const needProfile = <Note>{current ? `${current.name} has no profiles yet. Create one on the Setup tab.` : "Set up a game on the Setup tab first."}</Note>;
    const tabs = [
      { id: "mods", title: "Mods", content: ctx ? <ModsTab {...ctx} /> : needProfile },
      ...(current?.has_plugins ? [{
        id: "plugins", title: "Plugins",
        content: ctx ? <PluginsTab {...ctx} loot={current.loot} /> : needProfile,
      }] : []),
      {
        id: "setup", title: "Setup",
        content: (
          <SetupTab games={games} current={current} locked={busy} reload={reload}
            onConfigured={(g) => loadGames({ game: g })}
            onProfileCreated={(g, p) => loadGames({ game: g, profile: p })} />
        ),
      },
    ];
    body = (
      <div className="amd-tabs">
        <Tabs activeTab={tabs.some((t) => t.id === tab) ? tab : "mods"} onShowTab={setTab} tabs={tabs} />
      </div>
    );
  }

  const last = job.log[job.log.length - 1];
  const status = busy ? `Running ${job.action ?? ""}… ${last ?? ""}`
    : job.ok === false && last ? `Last job failed: ${last}`
    : current?.deploy_active ? `Deployed: ${current.deployed_profile || "?"}` : current ? "Nothing deployed (vanilla)" : "";

  return (
    <div className="amd-page">
      <style>{CSS}</style>
      {games && ready.length > 0 && (
        <Focusable className="amd-header" flow-children="horizontal">
          <div className="amd-pick">
            <Dropdown
              rgOptions={ready.map((g) => ({ data: g.name, label: g.name }))}
              selectedOption={game}
              disabled={busy}
              onChange={(o) => {
                const g = ready.find((x) => x.name === o.data);
                setGame(o.data);
                setProfile(g ? pickProfile(g) : undefined);
              }}
            />
          </div>
          <div className="amd-pick">
            <Dropdown
              rgOptions={(current?.profiles ?? []).map((p) => ({ data: p, label: p }))}
              selectedOption={profile}
              strDefaultLabel="No profiles"
              disabled={busy || !current?.profiles.length}
              onChange={(o) => setProfile(o.data)}
            />
          </div>
          {appId && (
            <DialogButton style={{ width: "auto", minWidth: 160 }} disabled={busy || !profile} onClick={() => deploy(true)}>
              Deploy &amp; Play
            </DialogButton>
          )}
          <DialogButton style={{ width: "auto", minWidth: 120 }} disabled={busy || !profile} onClick={() => deploy(false)}>
            Deploy
          </DialogButton>
        </Focusable>
      )}
      {status && <div className="amd-status">{status}</div>}
      {body}
    </div>
  );
}
