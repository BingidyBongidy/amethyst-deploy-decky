import { DialogButton, Focusable } from "@decky/ui";
import { SITE_NAMES, Source } from "./common";

/** The picked site doesn't have this game: say so instead of showing nothing. */
export function NotOnSite({ game, site, onOther, onSwitch, switchLabel }: {
  game: string; site: Source; onOther: () => void; onSwitch?: () => void; switchLabel: string;
}) {
  // Which sites a game is on comes from Amethyst's handler for it.
  const why = `Amethyst doesn't link this game to ${SITE_NAMES[site]}.`;
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
export function OtherSites({ onOpenDownloads }: { onOpenDownloads?: () => void }) {
  return (
    <Focusable flow-children="vertical" className="amd-section">
      <div className="amd-title">Mods from other sites</div>
      <div className="amd-sub amd-prose">
        Any mod archive (.zip, .7z, .rar) can be installed, wherever it comes from: ModDB, GitHub, a mod's own
        page and so on. Save it to your Downloads folder, from Steam's browser or by copying it over, then open
        the Downloads tab and press A on it. Installer options (FOMOD) show up here as usual.
      </div>
      {onOpenDownloads && (
        <DialogButton className="amd-button-auto amd-self-start amd-min-220" onClick={onOpenDownloads}>
          Open the Downloads tab
        </DialogButton>
      )}
    </Focusable>
  );
}
