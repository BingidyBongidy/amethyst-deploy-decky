import { ButtonItem, DropdownItem, PanelSection, PanelSectionRow } from "@decky/ui";
import { Game } from "../shared";
import { openFullUI } from "./useQamGames";

export function ProfilePicker({ games, current, game, profile, busy, onGame, onProfile }: {
  games: Game[]; current: Game | undefined; game: string | undefined; profile: string | undefined; busy: boolean;
  onGame: (game: string) => void; onProfile: (profile: string) => void;
}) {
  const deployedHere = current?.deploy_active
    ? `Deployed: ${current.deployed_profile || "?"}`
    : "Nothing deployed (vanilla)";
  return (
    <PanelSection title="Profile">
      <PanelSectionRow>
        <DropdownItem
          label="Game"
          rgOptions={games.map((g) => ({ data: g.name, label: g.name }))}
          selectedOption={game}
          onChange={(option) => onGame(option.data)}
          disabled={busy}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <DropdownItem
          label="Profile"
          rgOptions={(current?.profiles ?? []).map((p) => ({ data: p, label: p }))}
          selectedOption={profile}
          onChange={(option) => onProfile(option.data)}
          disabled={busy || !current?.profiles.length}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <div className="amd-qam-status">{deployedHere}</div>
      </PanelSectionRow>
    </PanelSection>
  );
}

export type Actions = {
  deployAndPlay: () => void;
  deploy: () => void;
  restore: () => void;
  refresh: () => void;
  update: () => void;
};

/** Deploy (& Play), Restore, Refresh, and the Flatpak-only Open/Update. */
export function ActionList({ flatpak, canPlay, canDeploy, canRestore, busy, loading, actions }: {
  /** Amethyst is the Flatpak: the full-screen page and updates work. */
  flatpak: boolean;
  canPlay: boolean;
  canDeploy: boolean;
  canRestore: boolean;
  busy: boolean;
  loading: boolean;
  actions: Actions;
}) {
  return (
    <PanelSection title="Actions">
      {flatpak && (
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={openFullUI}>
            Open Amethyst (mods, plugins, setup)
          </ButtonItem>
        </PanelSectionRow>
      )}
      {canPlay && (
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={busy || !canDeploy} onClick={actions.deployAndPlay}>
            Deploy &amp; Play
          </ButtonItem>
        </PanelSectionRow>
      )}
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy || !canDeploy} onClick={actions.deploy}>
          Deploy only
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy || !canRestore} onClick={actions.restore}>
          Restore vanilla
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy || loading} onClick={actions.refresh}>
          {loading ? "Refreshing…" : "Refresh games"}
        </ButtonItem>
      </PanelSectionRow>
      {flatpak && (
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={busy} onClick={actions.update}>
            Update Amethyst
          </ButtonItem>
        </PanelSectionRow>
      )}
    </PanelSection>
  );
}
