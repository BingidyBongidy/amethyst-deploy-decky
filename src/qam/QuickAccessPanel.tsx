import { ReactNode } from "react";
import { GamesResult, launchId, startGameJob, startJob, useJob } from "../shared";
import { Styles } from "../ui";
import { ActionList, ProfilePicker } from "./ProfileActions";
import { InstallAmethyst, JobLog, LoadFailed, NoGames, ScanningGames } from "./states";
import { useQamGames } from "./useQamGames";

/** The Quick Access panel: install Amethyst, or pick a profile and deploy/restore it. */
export function QuickAccessPanel() {
  const games = useQamGames();
  const [job, setJob] = useJob((status) => {
    if (status.ok) games.refresh(); // pick up new deploy state
  });
  const busy = !!job.running;
  const { current, profile } = games;
  const appId = current ? launchId(current) : null;

  const deploy = async (launchAppId: string | null) => {
    if (!current || !profile) return;
    setJob({ action: "deploy", running: true, log: [] });
    const err = await startGameJob("deploy", current, profile, launchAppId);
    if (err) setJob({ running: false, ok: false, log: [err] });
  };
  const restore = async () => {
    if (!current) return;
    setJob({ action: "restore", running: true, log: [] });
    const err = await startGameJob("restore", current, profile ?? "");
    if (err) setJob({ running: false, ok: false, log: [err] });
  };
  /** Install or update the Amethyst Flatpak (main.py start_job). */
  const manageAmethyst = async (action: "install" | "update") => {
    setJob({ action, running: true, log: [] });
    const reply = await startJob(action, "", "");
    if (!reply.ok) setJob({ running: false, ok: false, log: [reply.error ?? "failed"] });
  };

  const body = (data: GamesResult | null): ReactNode => {
    if (data && !data.ok && data.kind === "none") {
      return (
        <>
          <InstallAmethyst busy={busy} onInstall={() => manageAmethyst("install")} />
          <JobLog job={job} />
        </>
      );
    }
    if (!data && games.loading) return <ScanningGames />;
    if (data && !data.ok) return <LoadFailed error={data.error} loading={games.loading} onRetry={games.refresh} />;
    if (data && data.games.length === 0) return <NoGames data={data} loading={games.loading} onRefresh={games.refresh} />;
    return (
      <>
        <ProfilePicker games={data?.games ?? []} current={current} game={games.game} profile={profile} busy={busy}
          onGame={games.selectGame} onProfile={games.setProfile} />
        <ActionList flatpak={data?.kind === "flatpak"} canPlay={!!appId} canDeploy={!!profile}
          canRestore={!!current?.deploy_active} busy={busy} loading={games.loading}
          actions={{
            deployAndPlay: () => deploy(appId),
            deploy: () => deploy(null),
            restore,
            refresh: games.refresh,
            update: () => manageAmethyst("update"),
          }} />
        <JobLog job={job} />
      </>
    );
  };

  return (
    <>
      <Styles />
      {body(games.data)}
    </>
  );
}
