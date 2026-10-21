import { ConfirmModal, DialogButton, Dropdown, Focusable, showModal } from "@decky/ui";
import { useState } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import { Loading, Note, useRows } from "../ui";
import { chooseGameFolder } from "../setup/FolderPicker";
import { BridgeGame, bridge, errText, launchId, runApp, toast } from "../shared";
import { askNewProfile } from "./NewProfileModal";

type Detected = { name: string; launchers: string[] };
type Configured = {
  configured: boolean; path: string; prefix: string; source: string; needs_first_launch: boolean;
  /** A folder chosen by hand that doesn't look like the game: ask before using it (force). */
  needs_confirm?: boolean; message?: string;
};
type FirstLaunch = { name: string; source: string };
type Failure = { game: string; message: string };

const LAUNCHERS: Record<string, string> = {
  steam: "Steam", heroic: "Heroic", lutris: "Lutris", faugus: "Faugus", bottles: "Bottles",
  unifideck: "Unifideck", shortcut: "Non-Steam shortcut", standalone: "Standalone install", manual: "Chosen folder",
};
const launcherName = (launcher: string) => LAUNCHERS[launcher] ?? launcher;

/** Steam launches shortcuts and Unifideck games too, so those say "Steam". */
const launchedFrom = (source: string) =>
  (source === "steam" || source === "shortcut" || source === "unifideck" ? "Steam" : launcherName(source));

const SETUP_BUTTON = "amd-button-auto amd-self-start amd-min-240";

/**
 * Setting games up (bridge: configure_game): auto-detected, or from a folder
 * chosen by hand. Keeps the last failure and the games that need a first launch.
 */
function useGameSetup(onConfigured: (game: string) => void, onSetUp: (game: string) => void) {
  const [working, setWorking] = useState("");
  const [firstLaunch, setFirstLaunch] = useState<FirstLaunch[]>([]);
  // The last setup that failed, kept on screen with a way to pick the folder by hand.
  const [failed, setFailed] = useState<Failure | null>(null);

  const configure = async (name: string, path?: string, force = false) => {
    setWorking(name);
    setFailed(null);
    try {
      const result = await bridge<Configured>("configure_game", { game: name, ...(path ? { path, force } : {}) });
      if (result.needs_confirm) {
        showModal(<ConfirmModal strTitle="Use this folder anyway?" strDescription={result.message}
          strOKButtonText="Use it anyway" onOK={() => configure(name, path, true)} />);
        return;
      }
      onSetUp(name);
      if (result.needs_first_launch) setFirstLaunch((current) => [...current, { name, source: result.source }]);
      toast(`${name} is set up (${launcherName(result.source)}): ${result.path}`);
      onConfigured(name);
    } catch (e) {
      setFailed({ game: name, message: errText(e) });
    } finally {
      setWorking("");
    }
  };
  const pickFolder = (name: string) => chooseGameFolder(name, (path) => configure(name, path));
  return { working, firstLaunch, failed, configure, pickFolder };
}

type GameSetup = ReturnType<typeof useGameSetup>;

/** Set up games, create profiles and redo a game's setup. */
export function SetupTab({ games, current, locked, reload, onConfigured, onProfileCreated }: {
  games: BridgeGame[]; current?: BridgeGame; locked: boolean; reload: number;
  onConfigured: (game: string) => void; onProfileCreated: (game: string, profile: string) => void;
}) {
  const { rows, error, setRows } = useRows<Detected>(() => bridge<Detected[]>("detect_installed"), [reload]);
  const setup = useGameSetup(onConfigured,
    (name) => setRows((detected) => (detected ?? []).filter((d) => d.name !== name)));
  const blocked = locked || !!setup.working;

  return (
    <Focusable flow-children="vertical" className="amd-stack amd-gap-8">
      {current && <CurrentGame game={current} locked={locked} setup={setup} onProfileCreated={onProfileCreated} />}
      {setup.failed && <SetupFailed failure={setup.failed} disabled={blocked} onPickFolder={setup.pickFolder} />}
      {setup.firstLaunch.map((launch) => <FirstLaunchNote key={launch.name} launch={launch} games={games} />)}

      <div className="amd-status amd-gap-above">Installed games that aren't set up in Amethyst yet</div>
      <DetectedGames rows={rows} error={error} anyReady={games.some((g) => g.configured)} disabled={blocked} setup={setup} />

      <div className="amd-status amd-gap-above">Set up a game by hand (if it wasn't found above)</div>
      <SetUpByHand games={games.filter((g) => !g.configured)} disabled={blocked} onPickFolder={setup.pickFolder} />
    </Focusable>
  );
}

/** The selected game: its profiles, a new profile, and setting it up again. */
function CurrentGame({ game, locked, setup, onProfileCreated }: {
  game: BridgeGame; locked: boolean; setup: GameSetup; onProfileCreated: (game: string, profile: string) => void;
}) {
  // Setting up again changes the game folder; not while its mods are deployed.
  const cantRedo = locked || !!setup.working || game.deploy_active;
  const confirmRedo = () => showModal(
    <ConfirmModal strTitle={`Set up ${game.name} again?`}
      strDescription="Finds the game's folder and prefix again, the same way as the first setup. Your mods and profiles stay."
      strOKButtonText="Set up again"
      onOK={() => setup.configure(game.name)} />);
  return (
    <>
      <div className="amd-status">Profiles for {game.name}: {game.profiles.join(", ") || "none yet"}</div>
      <DialogButton className={SETUP_BUTTON} disabled={locked}
        onClick={() => askNewProfile(game.name, (profile) => onProfileCreated(game.name, profile))}>
        New profile for {game.name}
      </DialogButton>
      <DialogButton className={SETUP_BUTTON} disabled={cantRedo} onClick={confirmRedo}>
        Set up {game.name} again
      </DialogButton>
      <DialogButton className={SETUP_BUTTON} disabled={cantRedo} onClick={() => setup.pickFolder(game.name)}>
        Choose {game.name}'s folder…
      </DialogButton>
      {game.deploy_active && <div className="amd-sub">Restore vanilla first to set it up again.</div>}
    </>
  );
}

function SetupFailed({ failure, disabled, onPickFolder }: {
  failure: Failure; disabled: boolean; onPickFolder: (game: string) => void;
}) {
  return (
    <Focusable className="amd-bar amd-align-start" flow-children="horizontal">
      <span className="amd-err amd-error-message">
        <FaExclamationTriangle /> Couldn't set up {failure.game}: {failure.message}
      </span>
      <DialogButton className="amd-button-auto amd-min-180" disabled={disabled}
        onClick={() => onPickFolder(failure.game)}>Choose folder…</DialogButton>
    </Focusable>
  );
}

/** The game has no Wine/Proton prefix yet: it has to run once first. */
function FirstLaunchNote({ launch, games }: { launch: FirstLaunch; games: BridgeGame[] }) {
  const game = games.find((g) => g.name === launch.name);
  const appId = game ? launchId(game) : null;
  return (
    <Focusable className="amd-bar" flow-children="horizontal">
      <span className="amd-warn amd-fill">
        <FaExclamationTriangle /> Launch {launch.name} once from {launchedFrom(launch.source)} so it creates its Wine/Proton prefix, then set it up again here.
      </span>
      {appId && <DialogButton className="amd-button-auto" onClick={() => runApp(appId)}>Play now</DialogButton>}
    </Focusable>
  );
}

function DetectedGames({ rows, error, anyReady, disabled, setup }: {
  rows: Detected[] | null; error: string; anyReady: boolean; disabled: boolean; setup: GameSetup;
}) {
  if (error) return <Note>{error}</Note>;
  if (!rows) return <Loading text="Looking through your Steam libraries…" />;
  if (!rows.length) {
    return (
      <Note>
        {anyReady
          ? "No other supported games found."
          : "No supported games found."}{" "}
        It looks in Steam, Heroic, Unifideck, Lutris, Faugus, Bottles and your non-Steam shortcuts, for
        the games Amethyst supports. If a game you have isn't listed, set it up by hand below.
      </Note>
    );
  }
  return (
    <>
      {rows.map((detected) => (
        <Focusable key={detected.name} className="amd-bar" flow-children="horizontal">
          <div className="amd-grow">
            <div>{detected.name}</div>
            <div className="amd-tag">{detected.launchers.map(launcherName).join(" · ")}</div>
          </div>
          <DialogButton className="amd-button-auto amd-min-140" disabled={disabled}
            onClick={() => setup.configure(detected.name)}>
            {setup.working === detected.name ? "Setting up…" : "Set up"}
          </DialogButton>
          <DialogButton className="amd-button-auto amd-min-160" disabled={disabled}
            onClick={() => setup.pickFolder(detected.name)}>
            Choose folder…
          </DialogButton>
        </Focusable>
      ))}
    </>
  );
}

/** Any game Amethyst knows, set up from a folder picked by hand. */
function SetUpByHand({ games, disabled, onPickFolder }: {
  games: BridgeGame[]; disabled: boolean; onPickFolder: (game: string) => void;
}) {
  const [picked, setPicked] = useState<string | undefined>(undefined);
  return (
    <Focusable className="amd-bar" flow-children="horizontal">
      <div className="amd-min-280">
        <Dropdown rgOptions={games.map((g) => ({ data: g.name, label: g.name }))}
          selectedOption={picked} strDefaultLabel="Pick a game" onChange={(option) => setPicked(option.data)} />
      </div>
      <DialogButton className="amd-button-auto amd-min-180" disabled={disabled || !picked}
        onClick={() => picked && onPickFolder(picked)}>
        Choose its folder…
      </DialogButton>
    </Focusable>
  );
}
