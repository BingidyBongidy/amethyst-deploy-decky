import {
  ConfirmModal,
  DialogButton,
  Dropdown,
  Focusable,
  showModal,
  Tabs,
  TextField,
} from "@decky/ui";
import { ReactNode, useCallback, useEffect, useState } from "react";
import { FaExclamationTriangle, FaLock } from "react-icons/fa";
import { ReorderList } from "./ReorderList";
import { CSS, Check, Loading, Note, useRows } from "./ui";
import { TaskTray } from "./install/TaskTray";
import { DownloadsTab } from "./install/DownloadsTab";
import { GetModsTab } from "./getmods/GetModsTab";
import {
  BridgeGame, Mod, PluginRow, bridge, errText, resolveAppId, runApp, selection,
  startGameJob, toast, useBridgeEvent, useJob,
} from "./shared";

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

type Detected = { name: string; launchers: string[] };
type Configured = { configured: boolean; path: string; prefix: string; source: string; needs_first_launch: boolean };

const LAUNCHERS: Record<string, string> = {
  steam: "Steam", heroic: "Heroic", lutris: "Lutris", faugus: "Faugus", bottles: "Bottles",
  shortcut: "Non-Steam shortcut", standalone: "Standalone install", manual: "Chosen folder",
};
const launcherName = (l: string) => LAUNCHERS[l] ?? l;

function SetupTab({ games, current, locked, reload, onConfigured, onProfileCreated }: {
  games: BridgeGame[]; current?: BridgeGame; locked: boolean; reload: number;
  onConfigured: (game: string) => void; onProfileCreated: (game: string, profile: string) => void;
}) {
  const { rows, error, setRows } = useRows<Detected>(() => bridge<Detected[]>("detect_installed"), [reload]);
  const ready = games.filter((g) => g.configured);
  const [working, setWorking] = useState("");
  const [firstLaunch, setFirstLaunch] = useState<{ name: string; source: string }[]>([]);

  const configure = async (d: Detected) => {
    setWorking(d.name);
    try {
      const r = await bridge<Configured>("configure_game", { game: d.name });
      setRows((rs) => (rs ?? []).filter((x) => x.name !== d.name));
      if (r.needs_first_launch) setFirstLaunch((f) => [...f, { name: d.name, source: r.source }]);
      toast(`${d.name} is set up (${launcherName(r.source)})`);
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

      {firstLaunch.map(({ name, source }) => {
        const g = games.find((x) => x.name === name);
        const appId = g ? resolveAppId(g) : null;
        const from = source === "steam" || source === "shortcut" ? "Steam" : launcherName(source);
        return (
          <Focusable key={name} className="amd-bar" flow-children="horizontal">
            <span className="amd-warn" style={{ flex: 1 }}>
              <FaExclamationTriangle /> Launch {name} once from {from} so it creates its Wine/Proton prefix, then set it up again here.
            </span>
            {appId && <DialogButton style={{ width: "auto" }} onClick={() => runApp(appId)}>Play now</DialogButton>}
          </Focusable>
        );
      })}

      <div className="amd-status" style={{ marginTop: 12 }}>Installed games that aren't set up in Amethyst yet</div>
      {error ? <Note>{error}</Note> : !rows ? <Loading text="Looking through your Steam libraries…" /> :
        !rows.length ? (
          <Note>
            {ready.length
              ? "No other supported games found."
              : "No supported games found."}{" "}
            Amethyst looks in Steam, Heroic, Lutris, Faugus, Bottles and your non-Steam shortcuts, and only
            for games it has mod support for (Bethesda games, Cyberpunk 2077, Stardew Valley, Baldur's Gate 3,
            Balatro and others). Install one, then come back to this tab.
          </Note>
        ) :
          rows.map((d) => (
            <Focusable key={d.name} className="amd-bar" flow-children="horizontal">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>{d.name}</div>
                <div className="amd-tag">{d.launchers.map(launcherName).join(" · ")}</div>
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

  // A finished install changes the mod list (and maybe plugins).
  useBridgeEvent((event, data) => {
    if (event === "task" && data?.state === "done") setReload((n) => n + 1);
  });

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
      ...(current && (current.nexus_domain || current.ts_community) ? [{
        id: "get", title: "Get mods",
        content: ctx && current ? <GetModsTab game={current} profile={ctx.profile} locked={busy} reload={reload} /> : needProfile,
      }] : []),
      {
        id: "downloads", title: "Downloads",
        content: ctx && current ? <DownloadsTab game={current} profile={ctx.profile} locked={busy} reload={reload} /> : needProfile,
      },
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
      <TaskTray game={current} profile={profile} />
      {body}
    </div>
  );
}
