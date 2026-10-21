import { DialogButton, Focusable } from "@decky/ui";
import { useState } from "react";
import { FaFileArchive } from "react-icons/fa";
import { Loading, Note, formatSize, scrollOnFocus, useRows } from "../ui";
import { LocalArchive, TabProps, bridge, startInstall } from "../shared";

const age = (modified: number) => {
  // Seconds or milliseconds since the epoch, whichever the bridge sent.
  const ms = modified > 1e12 ? modified : modified * 1000;
  const seconds = Math.max(0, (Date.now() - ms) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  const days = Math.floor(seconds / 86400);
  if (days < 60) return days === 1 ? "yesterday" : `${days} days ago`;
  return new Date(ms).toLocaleDateString();
};

/** What A does here, or why it can't. */
function installHint(game: string, profile: string, locked: boolean): string {
  if (locked) return "A deploy is running; installing is paused until it finishes.";
  if (!profile) return "Pick a profile to install into.";
  return `A installs into ${game} · ${profile}`;
}

/** Archives in ~/Downloads (and Amethyst's extra download folders); A installs one
 * into the current profile as a background task the TaskTray follows. */
export function DownloadsTab({ game, profile, locked, reload }: TabProps) {
  const [refresh, setRefresh] = useState(0);
  const [starting, setStarting] = useState<Set<string>>(new Set());
  const { rows, error } = useRows<LocalArchive>(() => bridge<LocalArchive[]>("local_archives"), [refresh, reload]);

  const install = async (archive: LocalArchive) => {
    if (locked || !profile || starting.has(archive.path)) return;
    setStarting((current) => new Set(current).add(archive.path));
    try {
      await startInstall("install_archive", { game: game.name, profile, path: archive.path }, archive.name);
    } finally {
      setStarting((current) => {
        const next = new Set(current);
        next.delete(archive.path);
        return next;
      });
    }
  };

  return (
    <Focusable flow-children="vertical">
      <Focusable className="amd-bar" flow-children="horizontal">
        <DialogButton className="amd-button-auto amd-min-120" onClick={() => setRefresh((n) => n + 1)}>
          Refresh
        </DialogButton>
        <span className="amd-sub">{installHint(game.name, profile, locked)}</span>
      </Focusable>
      <ArchiveList rows={rows} error={error} starting={starting}
        installLabel={!locked && !!profile ? `Install into ${profile}` : undefined} onInstall={install} />
    </Focusable>
  );
}

function ArchiveList({ rows, error, starting, installLabel, onInstall }: {
  rows: LocalArchive[] | null; error: string; starting: Set<string>;
  /** The A hint; undefined when installing isn't possible now. */
  installLabel: string | undefined;
  onInstall: (archive: LocalArchive) => void;
}) {
  if (error) return <Note><span className="amd-err">{error}</span></Note>;
  if (!rows) return <Loading text="Looking for downloaded archives…" />;
  if (!rows.length) {
    return (
      <Note>
        No mod archives found. Save mod archives to Downloads (for example from another device or a Nexus
        "Manual download") and they appear here. Amethyst's extra download folders are checked too.
      </Note>
    );
  }
  return (
    <Focusable flow-children="vertical" className="amd-list">
      {rows.map((archive) => {
        const busy = starting.has(archive.path);
        return (
          <Focusable
            key={archive.path}
            className={`amd-row${installLabel ? "" : " amd-dim"}`}
            focusClassName="amd-focus"
            onFocus={scrollOnFocus}
            onActivate={() => onInstall(archive)}
            onOKActionDescription={busy ? undefined : installLabel}
          >
            <FaFileArchive className="amd-icon amd-fixed" />
            <div className="amd-grow">
              <div className="amd-name">{archive.name}</div>
              <div className="amd-sub amd-ellipsis">
                {[formatSize(archive.size), age(archive.modified), archive.folder].filter(Boolean).join(" · ")}
              </div>
            </div>
            {busy && <span className="amd-tag">Starting…</span>}
          </Focusable>
        );
      })}
    </Focusable>
  );
}
