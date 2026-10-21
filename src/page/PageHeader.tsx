import { DialogButton, Dropdown, Focusable } from "@decky/ui";
import { BridgeGame, JobStatus } from "../shared";

/** One line about the running job, the last failure, or what's deployed. */
function statusLine(job: JobStatus, current: BridgeGame | undefined): string {
  const last = job.log[job.log.length - 1];
  if (job.running) return `Running ${job.action ?? ""}… ${last ?? ""}`;
  if (job.ok === false && last) return `Last job failed: ${last}`;
  if (!current) return "";
  return current.deploy_active ? `Deployed: ${current.deployed_profile || "?"}` : "Nothing deployed (vanilla)";
}

/** Game and profile pickers, Deploy (& Play), and the job status line. */
export function PageHeader({ ready, current, game, profile, job, canPlay, onGame, onProfile, onDeployAndPlay, onDeploy }: {
  /** Games set up in Amethyst; no pickers until there's one. */
  ready: BridgeGame[];
  current: BridgeGame | undefined;
  game: string | undefined;
  profile: string | undefined;
  job: JobStatus;
  /** The game can be launched from Steam (it has a launch id). */
  canPlay: boolean;
  onGame: (game: string) => void;
  onProfile: (profile: string) => void;
  onDeployAndPlay: () => void;
  onDeploy: () => void;
}) {
  const busy = !!job.running;
  const status = statusLine(job, current);
  return (
    <>
      {ready.length > 0 && (
        <Focusable className="amd-header" flow-children="horizontal">
          <div className="amd-pick">
            <Dropdown
              rgOptions={ready.map((g) => ({ data: g.name, label: g.name }))}
              selectedOption={game}
              disabled={busy}
              onChange={(option) => onGame(option.data)}
            />
          </div>
          <div className="amd-pick">
            <Dropdown
              rgOptions={(current?.profiles ?? []).map((p) => ({ data: p, label: p }))}
              selectedOption={profile}
              strDefaultLabel="No profiles"
              disabled={busy || !current?.profiles.length}
              onChange={(option) => onProfile(option.data)}
            />
          </div>
          {canPlay && (
            <DialogButton className="amd-button-auto amd-min-160" disabled={busy || !profile} onClick={onDeployAndPlay}>
              Deploy &amp; Play
            </DialogButton>
          )}
          <DialogButton className="amd-button-auto amd-min-120" disabled={busy || !profile} onClick={onDeploy}>
            Deploy
          </DialogButton>
        </Focusable>
      )}
      {status && <div className="amd-status">{status}</div>}
    </>
  );
}
