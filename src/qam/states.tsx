import { ButtonItem, PanelSection, PanelSectionRow } from "@decky/ui";
import { GamesResult, JobStatus } from "../shared";
import { SpinnerLine } from "../ui";
import { openFullUI } from "./useQamGames";

function jobTitle(job: JobStatus): string {
  if (job.running) return `Running ${job.action ?? ""}…`;
  return job.ok ? "Done" : "Failed";
}

/** The last lines of the running (or last) job; nothing before the first job. */
export function JobLog({ job }: { job: JobStatus }) {
  if (!job.running && job.log.length === 0) return null;
  return (
    <PanelSection title={jobTitle(job)}>
      <PanelSectionRow>
        <div className="amd-qam-log">{job.log.slice(-8).join("\n") || "Starting…"}</div>
      </PanelSectionRow>
    </PanelSection>
  );
}

export function InstallAmethyst({ busy, onInstall }: { busy: boolean; onInstall: () => void }) {
  return (
    <PanelSection title="Amethyst">
      <PanelSectionRow>
        <div className="amd-qam-text">
          Amethyst Mod Manager isn't installed. This installs the official Flatpak
          from the developer's repo.
        </div>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={onInstall} disabled={busy}>
          {busy ? "Installing…" : "Install Amethyst"}
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}

export function ScanningGames() {
  return (
    <PanelSection>
      <PanelSectionRow>
        <SpinnerLine text="Scanning games…" />
      </PanelSectionRow>
    </PanelSection>
  );
}

export function LoadFailed({ error, loading, onRetry }: { error: string; loading: boolean; onRetry: () => void }) {
  return (
    <PanelSection title="Amethyst">
      <PanelSectionRow>
        <div className="amd-qam-text">{error}</div>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={onRetry} disabled={loading}>
          {loading ? "Checking…" : "Retry"}
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}

export function NoGames({ data, loading, onRefresh }: { data: GamesResult; loading: boolean; onRefresh: () => void }) {
  const flatpak = data.kind === "flatpak";
  return (
    <PanelSection title="Amethyst">
      <PanelSectionRow>
        <div className="amd-qam-text">
          Amethyst is installed, but no games are set up yet.
          {flatpak
            ? " Open Amethyst to set up a game Steam has installed."
            : " Open it once in Desktop Mode to point it at a game and create a profile."}
        </div>
      </PanelSectionRow>
      {flatpak && (
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={openFullUI}>Open Amethyst</ButtonItem>
        </PanelSectionRow>
      )}
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={onRefresh} disabled={loading}>Refresh</ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}
