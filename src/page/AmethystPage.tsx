import { DialogButton, Focusable, Tabs } from "@decky/ui";
import { ReactNode, useState } from "react";
import { Loading, Note, Styles } from "../ui";
import { TaskTray } from "../install/TaskTray";
import { DownloadsTab } from "../install/DownloadsTab";
import { GetModsTab } from "../getmods/GetModsTab";
import { BridgeGame, launchId, startGameJob, useBridgeEvent, useJob } from "../shared";
import { LoadOrderTab } from "./LoadOrderTab";
import { ModsTab } from "./ModsTab";
import { PageHeader } from "./PageHeader";
import { SetupTab } from "./SetupTab";
import { useGames } from "./useGames";

type Tab = { id: string; title: string; content: ReactNode };

/** The full-screen page: header, the install tray, and the tabs. */
export function AmethystPage() {
  const [tab, setTab] = useState("mods");
  const [reload, setReload] = useState(0);
  const library = useGames(() => setTab("setup"));
  const bumpReload = () => setReload((n) => n + 1);

  const [job, setJob] = useJob(() => {
    // Deploy state changed and the bridge was stopped for the job: reload everything.
    library.loadGames();
    bumpReload();
  });
  const busy = !!job.running;

  // A finished install changes the mod list (and maybe plugins).
  useBridgeEvent((event, data) => {
    if (event === "task" && data?.state === "done") bumpReload();
  });

  const current = library.current;
  const appId = current ? launchId(current) : null;
  const deploy = async (launchAppId: string | null) => {
    if (!current || !library.profile) return;
    setJob({ action: "deploy", running: true, log: [] });
    const err = await startGameJob("deploy", current, library.profile, launchAppId);
    if (err) setJob({ running: false, ok: false, log: [err] });
  };

  return (
    <div className="amd-page">
      <Styles />
      <PageHeader ready={library.ready} current={current} game={library.game} profile={library.profile} job={job}
        canPlay={!!appId} onGame={library.selectGame} onProfile={library.setProfile}
        onDeployAndPlay={() => deploy(appId)} onDeploy={() => deploy(null)} />
      <TaskTray game={current} />
      <PageBody library={library} locked={busy} reload={reload} tab={tab} onTab={setTab} />
    </div>
  );
}

function PageBody({ library, locked, reload, tab, onTab }: {
  library: ReturnType<typeof useGames>; locked: boolean; reload: number; tab: string; onTab: (tab: string) => void;
}) {
  if (library.error && !library.games) {
    return (
      <Focusable flow-children="vertical">
        <Note>{library.error}</Note>
        <DialogButton className="amd-button-auto amd-self-start" onClick={() => library.loadGames()}>Retry</DialogButton>
      </Focusable>
    );
  }
  if (!library.games) return <Loading text="Starting Amethyst… (the first time takes a few seconds)" />;

  const setup = (
    <SetupTab games={library.games} current={library.current} locked={locked} reload={reload}
      onConfigured={(game) => library.loadGames({ game })}
      onProfileCreated={(game, profile) => library.loadGames({ game, profile })} />
  );
  const tabs = pageTabs(library.current, library.profile, { locked, reload, setup, onOpenDownloads: () => onTab("downloads") });
  return (
    <div className="amd-tabs">
      <Tabs activeTab={tabs.some((t) => t.id === tab) ? tab : "mods"} onShowTab={onTab} tabs={tabs} />
    </div>
  );
}

/**
 * The tabs: Mods, Load order (games with plugins), Get mods, Downloads and Setup.
 * Without a game and profile, every tab but Setup says what to do first.
 */
function pageTabs(current: BridgeGame | undefined, profile: string | undefined, page: {
  locked: boolean; reload: number; setup: ReactNode; onOpenDownloads: () => void;
}): Tab[] {
  const setupTab = { id: "setup", title: "Setup", content: page.setup };
  const loadOrder = current?.has_plugins ? [{ id: "plugins", title: "Load order" }] : [];
  if (!current || !profile) {
    const needProfile = (
      <Note>{current ? `${current.name} has no profiles yet. Create one on the Setup tab.` : "Set up a game on the Setup tab first."}</Note>
    );
    const placeholders = [{ id: "mods", title: "Mods" }, ...loadOrder, { id: "get", title: "Get mods" }, { id: "downloads", title: "Downloads" }];
    return [...placeholders.map((t) => ({ ...t, content: needProfile })), setupTab];
  }

  const context = { game: current.name, profile, locked: page.locked, reload: page.reload };
  return [
    { id: "mods", title: "Mods", content: <ModsTab {...context} /> },
    ...loadOrder.map((t) => ({ ...t, content: <LoadOrderTab {...context} loot={current.loot} /> })),
    {
      id: "get", title: "Get mods",
      content: <GetModsTab game={current} profile={profile} locked={page.locked} reload={page.reload}
        onOpenDownloads={page.onOpenDownloads} />,
    },
    {
      id: "downloads", title: "Downloads",
      content: <DownloadsTab game={current} profile={profile} locked={page.locked} reload={page.reload} />,
    },
    setupTab,
  ];
}
