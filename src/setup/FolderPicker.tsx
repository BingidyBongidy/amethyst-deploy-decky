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
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setListing(null);
    setError("");
    bridge<Listing>("browse_folders", { path, game }).then(
      (loaded) => live && setListing(loaded), (e) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [path, game]);

  const pick = (folder: string) => {
    closeModal?.();
    onPick(folder);
  };
  const up = () => setPath(listing?.parent ?? "");

  return (
    <ModalRoot closeModal={closeModal} bAllowFullSize>
      <Styles />
      <div className="amd-modal amd-modal-large">
        <div className="amd-title-large">Choose {game}'s folder</div>
        <div className="amd-sub amd-break-all">
          {path ? path : "Pick where to start looking."}
          {listing?.looks_like_game && <span className="amd-ok"> · <FaCheckCircle /> looks like {game}</span>}
        </div>
        <div className="amd-sub">A opens a folder · X uses the highlighted folder · folders marked with a tick hold the game.</div>
        <Focusable flow-children="vertical" className="amd-scroll amd-list amd-fill-height"
          onCancelButton={path ? swallowB(up) : undefined} onCancelActionDescription={path ? "Up a folder" : undefined}>
          <FolderRows game={game} path={path} listing={listing} error={error} onOpen={setPath} onUp={up} onPick={pick} />
        </Focusable>
        <Focusable className="amd-btns" flow-children="horizontal">
          <DialogButton disabled={!path} onClick={() => pick(path)}>Use this folder</DialogButton>
          <DialogButton onClick={() => closeModal?.()}>Cancel</DialogButton>
        </Focusable>
      </div>
    </ModalRoot>
  );
}

function FolderRows({ game, path, listing, error, onOpen, onUp, onPick }: {
  game: string; path: string; listing: Listing | null; error: string;
  onOpen: (path: string) => void; onUp: () => void; onPick: (path: string) => void;
}) {
  if (error) return <div className="amd-err">{error}</div>;
  if (!listing) return <Loading text="Reading folders…" />;
  return (
    <>
      {path && (
        <Focusable className="amd-row" focusClassName="amd-focus" onFocus={scrollOnFocus}
          onActivate={onUp} onOKActionDescription="Up a folder">
          <FaArrowUp /> <span className="amd-name">Up to {listing.parent || "start"}</span>
        </Focusable>
      )}
      {listing.folders.map((folder) => (
        <Focusable key={folder.path} className="amd-row" focusClassName="amd-focus" onFocus={scrollOnFocus}
          onActivate={() => onOpen(folder.path)} onOKActionDescription="Open"
          onSecondaryButton={() => onPick(folder.path)} onSecondaryActionDescription="Use this folder">
          <FaFolder className="amd-icon" />
          <span className="amd-name">{folder.name}</span>
          {folder.looks_like_game && <span className="amd-tag amd-ok"><FaCheckCircle /> {game}</span>}
        </Focusable>
      ))}
      {listing.folders.length === 0 && <div className="amd-sub amd-empty">No folders here.</div>}
    </>
  );
}

export const chooseGameFolder = (game: string, onPick: (path: string) => void) =>
  showModal(<FolderPicker game={game} onPick={onPick} />);
