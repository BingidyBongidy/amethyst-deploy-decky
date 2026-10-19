import {
  ButtonItem,
  Navigation,
  DropdownItem,
  PanelSection,
  PanelSectionRow,
  Spinner,
  staticClasses,
} from "@decky/ui";
import {
  addEventListener,
  removeEventListener,
  definePlugin,
  routerHook,
} from "@decky/api";
import { useEffect, useState } from "react";
import { FaGem } from "react-icons/fa";
import { AmethystPage } from "./AmethystPage";
import {
  GamesResult, JobStatus, launchId, listGames, runApp, selection,
  startGameJob, startJob, takePendingLaunch, toast, useJob,
} from "./shared";

// Survives the QAM panel being closed/reopened.
let cache: GamesResult | null = null;

function openFullUI() {
  cache = null; // games or profiles may change in there; rescan when the panel reopens
  Navigation.Navigate("/amethyst");
  Navigation.CloseSideMenus();
}

function Content() {
  const [data, setData] = useState<GamesResult | null>(cache);
  const [loading, setLoading] = useState(false);
  const [game, setGame] = useState<string | undefined>(selection.game);
  const [profile, setProfile] = useState<string | undefined>(selection.profile);
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

  const [job, setJob] = useJob((s) => {
    if (s.ok) refresh(); // pick up new deploy state
  });

  useEffect(() => {
    if (!cache) refresh();
  }, []);

  useEffect(() => {
    selection.game = game;
    selection.profile = profile;
  }, [game, profile]);

  const current = data?.games.find((g) => g.name === game);
  const appId = current ? launchId(current) : null;
  const busy = !!job.running;

  const run = async (action: "deploy" | "restore", launch = false) => {
    if (!current) return;
    if (action === "deploy" && !profile) return;
    setJob({ action, running: true, log: [] });
    const err = await startGameJob(action, current, profile ?? "", launch ? appId : null);
    if (err) setJob({ running: false, ok: false, log: [err] });
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
            Amethyst is installed, but no games are set up yet.
            {data.kind === "flatpak"
              ? " Open Amethyst to set up a game Steam has installed."
              : " Open it once in Desktop Mode to point it at a game and create a profile."}
          </div>
        </PanelSectionRow>
        {data.kind === "flatpak" && (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={openFullUI}>Open Amethyst</ButtonItem>
          </PanelSectionRow>
        )}
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
        {data?.kind === "flatpak" && (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={openFullUI}>
              Open Amethyst (mods, plugins, setup)
            </ButtonItem>
          </PanelSectionRow>
        )}
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
  routerHook.addRoute("/amethyst", AmethystPage, { exact: true });

  // Global listener: finish-up work happens even if the QAM panel is closed.
  const done = addEventListener<[JobStatus]>("amethyst_done", (s) => {
    const label = s.action === "install" ? "Amethyst installed"
      : s.action === "update" ? "Amethyst updated"
      : s.action === "restore" ? `${s.game}: restored` : `${s.game} / ${s.profile}`;
    toast(s.ok ? label : `${label} - open the plugin for the log`,
          s.ok ? "Amethyst: done" : "Amethyst: failed");
    if (s.ok) cache = null; // deploy state changed; rescan next open
    const launch = takePendingLaunch();
    if (s.ok && launch) runApp(launch);
  });

  // Installs keep running when the page is closed: say when one finishes or
  // needs an answer (the prompt opens again in the full-screen page).
  const asked = new Set<string>();
  const onTask = addEventListener<[string, any]>("amethyst_event", (event, t) => {
    if (event !== "task" || !t) return;
    if (t.state === "done") {
      toast(`Installed ${(t.result?.installed ?? [t.title]).join(", ")}`);
    } else if (t.state === "error") {
      toast(`Install failed: ${t.title}: ${t.error || "Failed"}`);
    } else if (t.state === "choice" && !asked.has(t.id)) {
      asked.add(t.id);
      toast(`${t.title}: choose options in Amethyst`, "Amethyst needs you", openFullUI);
    }
  });

  return {
    name: "Amethyst Deploy",
    titleView: <div className={staticClasses.Title}>Amethyst Deploy</div>,
    content: <Content />,
    icon: <FaGem />,
    onDismount() {
      removeEventListener("amethyst_done", done);
      removeEventListener("amethyst_event", onTask);
      routerHook.removeRoute("/amethyst");
    },
  };
});
