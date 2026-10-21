import { DialogButton, Focusable } from "@decky/ui";
import { SITE_NAMES, Source } from "./common";

/** The picked site doesn't have this game: say so instead of showing nothing. */
export function NotOnSite({ game, site, onOther, onSwitch, switchLabel }: {
  game: string; site: Source; onOther: () => void; onSwitch?: () => void; switchLabel: string;
}) {
  const why = site === "ts"
    ? "Thunderstore only has mods for some games, mostly ones modded with BepInEx (Valheim, Lethal Company, Risk of Rain 2, Subnautica and others)."
    : "Amethyst doesn't know a Nexus Mods page for this game.";
  return (
    <Focusable flow-children="vertical" className="amd-section">
      <div className="amd-title">{game} isn't on {SITE_NAMES[site]}</div>
      <div className="amd-sub amd-wrap-text">{why}</div>
      <Focusable flow-children="horizontal" className="amd-hstack">
        {onSwitch && <DialogButton className="amd-button-auto amd-min-200" onClick={onSwitch}>{switchLabel}</DialogButton>}
        <DialogButton className="amd-button-auto amd-min-200" onClick={onOther}>Other sites</DialogButton>
      </Focusable>
    </Focusable>
  );
}

/** Mods from anywhere else go through the Downloads tab. */
export function OtherSites({ game, bg3, onOpenDownloads }: { game: string; bg3: boolean; onOpenDownloads?: () => void }) {
  return (
    <Focusable flow-children="vertical" className="amd-section">
      <div className="amd-title">Mods from other sites</div>
      <div className="amd-sub amd-prose">
        Any mod archive (.zip, .7z, .rar) can be installed, wherever it comes from: ModDB, GitHub, a mod's own
        page and so on. Save it to your Downloads folder, from Steam's browser or by copying it over, then open
        the Downloads tab and press A on it. Installer options (FOMOD) show up here as usual.
      </div>
      {bg3 && (
        <div className="amd-warn amd-prose">
          {game}: mods from mod.io, the game's official mod site, are installed from the game itself.
          Start the game and open Mod Manager from the main menu. They work alongside the mods installed here.
        </div>
      )}
      {onOpenDownloads && (
        <DialogButton className="amd-button-auto amd-self-start amd-min-220" onClick={onOpenDownloads}>
          Open the Downloads tab
        </DialogButton>
      )}
    </Focusable>
  );
}
