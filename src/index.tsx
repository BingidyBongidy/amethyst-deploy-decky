import {
  ButtonItem,
  DropdownItem,
  PanelSection,
  PanelSectionRow,
  Spinner,
  staticClasses,
} from "@decky/ui";
import {
  addEventListener,
  removeEventListener,
  callable,
  definePlugin,
  toaster,
} from "@decky/api";
import { useEffect, useState } from "react";
import { FaGem } from "react-icons/fa";

type Game = {
  name: string;
  game_id: string;
  steam_id: string;
  configured: boolean;
  profiles: string[];
  deployed_profile: string;
  deploy_active: boolean;
};
type GamesResult = { ok: boolean; kind: string; games: Game[]; error: string };
type JobStatus = {
  action?: string;
  game?: string;
  profile?: string;
  running?: boolean;
  ok?: boolean | null;
  log: string[];
};

const listGames = callable<[], GamesResult>("list_games");
const startJob = callable<[action: string, game: string, profile: string], { ok: boolean; error?: string }>("start_job");
const jobStatus = callable<[], JobStatus>("job_status");

declare const SteamClient: any;
declare const collectionStore: any;

// Survives the QAM panel being closed/reopened.
let cache: GamesResult | null = null;
let selection: { game?: string; profile?: string } = {};
let pendingLaunch: string | null = null;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Steam app ID for a game: Amethyst's own if it has one, else match by name in the library. */
function resolveAppId(g: Game): string | null {
  if (g.steam_id) return g.steam_id;
  try {
    const apps: any[] = collectionStore?.allAppsCollection?.allApps ?? [];
    const target = norm(g.name);
    const exact = apps.find((a) => norm(a.display_name ?? "") === target);
    if (exact) return String(exact.appid);
    const loose = apps.find((a) => {
      const n = norm(a.display_name ?? "");
      return n.length > 3 && (n.includes(target) || target.includes(n));
    });
    return loose ? String(loose.appid) : null;
  } catch {
    return null;
  }
}

function runApp(appId: string) {
  try {
    SteamClient.Apps.RunGame(appId, "", -1, 100);
  } catch (e) {
    toaster.toast({ title: "Amethyst", body: `Couldn't launch: ${e}` });
  }
}

function Content() {
  const [data, setData] = useState<GamesResult | null>(cache);
  const [loading, setLoading] = useState(false);
  const [game, setGame] = useState<string | undefined>(selection.game);
  const [profile, setProfile] = useState<string | undefined>(selection.profile);
  const [job, setJob] = useState<JobStatus>({ log: [] });

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await listGames();
      cache = r;
      setData(r);
      if (r.ok && r.games.length) {
        // read the module-level selection, not state - this closure can be stale
        const g = r.games.find((x) => x.name === selection.game) ?? r.games[0];
        const profile = g.name === selection.game ? selection.profile : undefined;
        setGame(g.name);
        if (profile && g.profiles.includes(profile)) {
          setProfile(profile);
        } else {
          setProfile(g.deployed_profile && g.profiles.includes(g.deployed_profile)
            ? g.deployed_profile : g.profiles[0]);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!cache) refresh();
    jobStatus().then(setJob);
    const onLog = addEventListener<[string]>("amethyst_log", (line) =>
      setJob((j) => {
        const last = j.log[j.log.length - 1];
        // collapse flatpak progress redraws into one line
        const strip = (s: string) => s.replace(/[\d.%\s/]+/g, "").slice(0, 30);
        const log = last && line.includes("%") && strip(last) === strip(line)
          ? [...j.log.slice(0, -1), line] : [...j.log, line];
        return { ...j, running: true, log: log.slice(-20) };
      }));
    const onDone = addEventListener<[JobStatus]>("amethyst_done", (s) => {
      setJob((j) => ({ ...j, ...s, log: j.log }));
      if (s.ok) refresh(); // pick up new deploy state
    });
    return () => {
      removeEventListener("amethyst_log", onLog);
      removeEventListener("amethyst_done", onDone);
    };
  }, []);

  useEffect(() => { selection = { game, profile }; }, [game, profile]);

  const current = data?.games.find((g) => g.name === game);
  const appId = current ? resolveAppId(current) : null;
  const busy = !!job.running;

  const run = async (action: "deploy" | "restore", launch = false) => {
    if (!current) return;
    if (action === "deploy" && !profile) return;
    const key = current.game_id || current.name;
    pendingLaunch = launch && appId ? appId : null;
    setJob({ action, running: true, log: [] });
    const r = await startJob(action, key, profile ?? "");
    if (!r.ok) {
      pendingLaunch = null;
      setJob({ running: false, ok: false, log: [r.error ?? "failed"] });
    }
  };

  const manage = async (action: "install" | "update") => {
    setJob({ action, running: true, log: [] });
    const r = await startJob(action, "", "");
    if (!r.ok) setJob({ running: false, ok: false, log: [r.error ?? "failed"] });
  };

  const logPanel = (busy || job.log.length > 0) && (
    <PanelSection title={busy ? `Running ${job.action ?? ""}…` : job.ok ? "Done" : "Failed"}>
      <PanelSectionRow>
        <div style={{
          fontFamily: "monospace", fontSize: 10, whiteSpace: "pre-wrap",
          wordBreak: "break-word", maxHeight: 160, overflowY: "auto", opacity: 0.85,
        }}>
          {job.log.slice(-8).join("\n") || "Starting…"}
        </div>
      </PanelSectionRow>
    </PanelSection>
  );

  if (data && !data.ok && data.kind === "none") {
    return (
      <>
        <PanelSection title="Amethyst">
          <PanelSectionRow>
            <div style={{ fontSize: 13 }}>
              Amethyst Mod Manager isn't installed. This installs the official Flatpak
              from the developer's repo.
            </div>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={() => manage("install")} disabled={busy}>
              {busy ? "Installing…" : "Install Amethyst"}
            </ButtonItem>
          </PanelSectionRow>
        </PanelSection>
        {logPanel}
      </>
    );
  }

  if (!data && loading) {
    return (
      <PanelSection>
        <PanelSectionRow>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Spinner style={{ height: 20 }} /> Scanning games…
          </div>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  if (data && !data.ok) {
    return (
      <PanelSection title="Amethyst">
        <PanelSectionRow>
          <div style={{ fontSize: 13 }}>{data.error}</div>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={refresh} disabled={loading}>
            {loading ? "Checking…" : "Retry"}
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  if (data && data.games.length === 0) {
    return (
      <PanelSection title="Amethyst">
        <PanelSectionRow>
          <div style={{ fontSize: 13 }}>
            Amethyst is installed, but no games are set up yet. Open it once in Desktop Mode
            to point it at a game, log in to Nexus and create a profile.
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={refresh} disabled={loading}>Refresh</ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  const deployedHere = current?.deploy_active
    ? `Deployed: ${current.deployed_profile || "?"}`
    : "Nothing deployed (vanilla)";

  return (
    <>
      <PanelSection title="Profile">
        <PanelSectionRow>
          <DropdownItem
            label="Game"
            rgOptions={(data?.games ?? []).map((g) => ({ data: g.name, label: g.name }))}
            selectedOption={game}
            onChange={(o) => {
              const g = data?.games.find((x) => x.name === o.data);
              setGame(o.data);
              setProfile(g?.deployed_profile && g.profiles.includes(g.deployed_profile)
                ? g.deployed_profile : g?.profiles[0]);
            }}
            disabled={busy}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <DropdownItem
            label="Profile"
            rgOptions={(current?.profiles ?? []).map((p) => ({ data: p, label: p }))}
            selectedOption={profile}
            onChange={(o) => setProfile(o.data)}
            disabled={busy || !current?.profiles.length}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{deployedHere}</div>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Actions">
        {appId && (
          <PanelSectionRow>
            <ButtonItem layout="below" disabled={busy || !profile} onClick={() => run("deploy", true)}>
              Deploy &amp; Play
            </ButtonItem>
          </PanelSectionRow>
        )}
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={busy || !profile} onClick={() => run("deploy")}>
            Deploy only
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={busy || !current?.deploy_active} onClick={() => run("restore")}>
            Restore vanilla
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={busy || loading} onClick={refresh}>
            {loading ? "Refreshing…" : "Refresh games"}
          </ButtonItem>
        </PanelSectionRow>
        {data?.kind === "flatpak" && (
          <PanelSectionRow>
            <ButtonItem layout="below" disabled={busy} onClick={() => manage("update")}>
              Update Amethyst
            </ButtonItem>
          </PanelSectionRow>
        )}
      </PanelSection>

      {logPanel}
    </>
  );
}

export default definePlugin(() => {
  // Global listener: finish-up work happens even if the QAM panel is closed.
  const done = addEventListener<[JobStatus]>("amethyst_done", (s) => {
    const label = s.action === "install" ? "Amethyst installed"
      : s.action === "update" ? "Amethyst updated"
      : s.action === "restore" ? `${s.game}: restored` : `${s.game} / ${s.profile}`;
    toaster.toast({
      title: s.ok ? "Amethyst: done" : "Amethyst: failed",
      body: s.ok ? label : `${label} - open the plugin for the log`,
    });
    if (s.ok) cache = null; // deploy state changed; rescan next open
    if (s.ok && pendingLaunch) runApp(pendingLaunch);
    pendingLaunch = null;
  });

  return {
    name: "Amethyst Deploy",
    titleView: <div className={staticClasses.Title}>Amethyst Deploy</div>,
    content: <Content />,
    icon: <FaGem />,
    onDismount() {
      removeEventListener("amethyst_done", done);
    },
  };
});
