import { DialogButton, Focusable } from "@decky/ui";
import { useState } from "react";
import { FaFileArchive } from "react-icons/fa";
import { Loading, Note, useRows } from "../ui";
import { LocalArchive, TabProps, Task, bridge, errText, toast } from "../shared";
import { humanSize } from "./common";

const age = (modified: number) => {
  const ms = modified > 1e12 ? modified : modified * 1000;
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  if (d < 60) return d === 1 ? "yesterday" : `${d} days ago`;
  return new Date(ms).toLocaleDateString();
};

/** Archives in ~/Downloads (and Amethyst's extra download folders); A installs one
 * into the current profile as a background task the TaskTray follows. */
export function DownloadsTab({ game, profile, locked }: TabProps) {
  const [refresh, setRefresh] = useState(0);
  const [starting, setStarting] = useState<Set<string>>(new Set());
  const { rows, error } = useRows<LocalArchive>(() => bridge<LocalArchive[]>("local_archives"), [refresh]);

  const install = async (a: LocalArchive) => {
    if (locked || !profile || starting.has(a.path)) return;
    setStarting((s) => new Set(s).add(a.path));
    try {
      await bridge<Task>("install_archive", { game: game.name, profile, path: a.path });
      toast(`Installing ${a.name}`);
    } catch (e) {
      toast(errText(e));
    } finally {
      setStarting((s) => {
        const c = new Set(s);
        c.delete(a.path);
        return c;
      });
    }
  };

  const canInstall = !locked && !!profile;
  let body;
  if (error) body = <Note><span className="amd-err">{error}</span></Note>;
  else if (!rows) body = <Loading text="Looking for downloaded archives…" />;
  else if (!rows.length) {
    body = (
      <Note>
        No mod archives found. Save mod archives to Downloads (for example from another device or a Nexus
        "Manual download") and they appear here. Amethyst's extra download folders are checked too.
      </Note>
    );
  } else {
    body = (
      <Focusable flow-children="vertical" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {rows.map((a) => {
          const busy = starting.has(a.path);
          return (
            <Focusable
              key={a.path}
              className={`amd-row${canInstall ? "" : " amd-dim"}`}
              focusClassName="amd-focus"
              onFocus={(e) => (e.currentTarget as HTMLElement).scrollIntoView?.({ block: "nearest" })}
              onActivate={() => install(a)}
              onOKActionDescription={canInstall && !busy ? `Install into ${profile}` : undefined}
            >
              <FaFileArchive style={{ opacity: 0.7, flex: "none" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="amd-name">{a.name}</div>
                <div className="amd-sub" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {humanSize(a.size)} · {age(a.modified)} · {a.folder}
                </div>
              </div>
              {busy && <span className="amd-tag">Starting…</span>}
            </Focusable>
          );
        })}
      </Focusable>
    );
  }

  return (
    <Focusable flow-children="vertical">
      <Focusable className="amd-bar" flow-children="horizontal">
        <DialogButton style={{ width: "auto", minWidth: 120 }} onClick={() => setRefresh((n) => n + 1)}>
          Refresh
        </DialogButton>
        <span className="amd-sub">
          {locked ? "A deploy is running; installing is paused until it finishes."
            : !profile ? "Pick a profile to install into."
            : `A installs into ${game.name} · ${profile}`}
        </span>
      </Focusable>
      {body}
    </Focusable>
  );
}
