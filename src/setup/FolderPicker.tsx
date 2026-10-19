import { DialogButton, Focusable, ModalRoot, showModal } from "@decky/ui";
import { useEffect, useState } from "react";
import { FaArrowUp, FaCheckCircle, FaFolder } from "react-icons/fa";
import { Loading, Styles, scrollOnFocus, swallowB } from "../ui";
import { bridge, errText } from "../shared";

type Folder = { name: string; path: string; looks_like_game: boolean };
type Listing = { path: string; parent: string; looks_like_game: boolean; folders: Folder[] };

/**
 * Pick a game's folder with the controller (bridge: browse_folders).
 * Starts at the places games live (home, SD cards, Steam libraries); A opens a
 * folder, X uses the focused one, "Use this folder" uses the one you're in.
 * Folders that hold the game's exe or base-game files get a badge.
 */
function FolderPicker({ game, onPick, closeModal }: {
  game: string; onPick: (path: string) => void; closeModal?: () => void;
}) {
  const [path, setPath] = useState("");
  const [list, setList] = useState<Listing | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setList(null);
    setError("");
    bridge<Listing>("browse_folders", { path, game }).then(
      (l) => live && setList(l), (e) => live && setError(errText(e)));
    return () => { live = false; };
  }, [path]);

  const pick = (p: string) => {
    closeModal?.();
    onPick(p);
  };
  const up = () => setPath(list?.parent ?? "");

  return (
    <ModalRoot closeModal={closeModal} bAllowFullSize>
      <Styles />
      <div className="amd-modal" style={{ width: "min(900px, calc(100vw - 140px))", height: "min(560px, calc(100vh - 180px))",
        display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 20, fontWeight: 600 }}>Choose {game}'s folder</div>
        <div className="amd-sub" style={{ wordBreak: "break-all" }}>
          {path ? path : "Pick where to start looking."}
          {list?.looks_like_game && <span style={{ color: "#5ba32b" }}> · <FaCheckCircle /> looks like {game}</span>}
        </div>
        <div className="amd-sub">A opens a folder · X uses the highlighted folder · folders marked with a tick hold the game.</div>
        <Focusable flow-children="vertical" className="amd-scroll"
          onCancelButton={path ? swallowB(up) : undefined} onCancelActionDescription={path ? "Up a folder" : undefined}
          style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          {error ? <div className="amd-err">{error}</div> : !list ? <Loading text="Reading folders…" /> : (
            <>
              {path && (
                <Focusable className="amd-row" focusClassName="amd-focus" onFocus={scrollOnFocus}
                  onActivate={up} onOKActionDescription="Up a folder">
                  <FaArrowUp /> <span className="amd-name">Up to {list.parent || "start"}</span>
                </Focusable>
              )}
              {list.folders.map((f) => (
                <Focusable key={f.path} className="amd-row" focusClassName="amd-focus" onFocus={scrollOnFocus}
                  onActivate={() => setPath(f.path)} onOKActionDescription="Open"
                  onSecondaryButton={() => pick(f.path)} onSecondaryActionDescription="Use this folder">
                  <FaFolder style={{ opacity: 0.7 }} />
                  <span className="amd-name">{f.name}</span>
                  {f.looks_like_game && <span className="amd-tag" style={{ color: "#5ba32b", opacity: 1 }}><FaCheckCircle /> {game}</span>}
                </Focusable>
              ))}
              {list.folders.length === 0 && <div className="amd-sub" style={{ padding: 8 }}>No folders here.</div>}
            </>
          )}
        </Focusable>
        <Focusable className="amd-btns" flow-children="horizontal" style={{ display: "flex", gap: 10 }}>
          <DialogButton disabled={!path} onClick={() => pick(path)}>Use this folder</DialogButton>
          <DialogButton onClick={() => closeModal?.()}>Cancel</DialogButton>
        </Focusable>
      </div>
    </ModalRoot>
  );
}

export const chooseGameFolder = (game: string, onPick: (path: string) => void) =>
  showModal(<FolderPicker game={game} onPick={onPick} />);
