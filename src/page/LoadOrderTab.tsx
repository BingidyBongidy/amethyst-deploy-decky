import { DialogButton, Focusable } from "@decky/ui";
import { useEffect, useState } from "react";
import { FaExclamationTriangle, FaLock } from "react-icons/fa";
import { ReorderList } from "../ReorderList";
import { Check, Loading, Note, useRows } from "../ui";
import { PluginRow, bridge, toast } from "../shared";
import type { TabContext } from "./types";

type LootResult = { moved: number; warnings: string[]; plugins: PluginRow[]; log: string[] };

type FolderCheck = {
  game_path: string; data_path: string; data_exists: boolean;
  expected: string[]; game_folder: string[]; data_folder: string[];
};

/** No base-game plugins found: show where Amethyst looked and what's there, so
 * the cause (wrong game folder, Data folder spelled differently) is visible. */
function BaseGameMissing({ game }: { game: string }) {
  const [info, setInfo] = useState<FolderCheck | null>(null);
  useEffect(() => {
    bridge<FolderCheck>("game_folder_check", { game }).then(setInfo, () => {});
  }, [game]);
  if (!info || info.expected.length === 0) return null;   // game has no base-game plugin list
  return (
    <div className="amd-warn amd-callout">
      <div><FaExclamationTriangle /> The base game's files ({info.expected.join(", ")}) weren't found, so every
        mod that needs them shows "Missing". If this game was set up before, try Set up again on the Setup tab.</div>
      <div className="amd-sub">Looked in: {info.data_path || "(no game folder saved)"}
        {info.data_exists ? "" : " (this folder doesn't exist)"}</div>
      {info.data_exists && <div className="amd-sub">It contains: {info.data_folder.join(", ") || "nothing"}</div>}
      <div className="amd-sub">Game folder {info.game_path} contains: {info.game_folder.join(", ") || "nothing"}</div>
    </div>
  );
}

function PluginRowContent({ plugin }: { plugin: PluginRow }) {
  return (
    <>
      {plugin.vanilla ? <FaLock className="amd-faint" /> : <Check on={plugin.enabled} />}
      <span className="amd-name">{plugin.name}</span>
      {plugin.missing_masters.length > 0 && (
        <span className="amd-err"><FaExclamationTriangle /> Missing: {plugin.missing_masters.join(", ")}</span>
      )}
      {plugin.late_masters.length > 0 && (
        <span className="amd-warn"><FaExclamationTriangle /> Loads before: {plugin.late_masters.join(", ")}</span>
      )}
      {plugin.master && <span className="amd-tag">ESM</span>}
      {plugin.light && <span className="amd-tag">ESL</span>}
    </>
  );
}

/** The plugin load order (Bethesda games): A toggles, X moves, LOOT sorts. */
export function LoadOrderTab({ game, profile, loot, locked, reload }: TabContext & { loot: boolean }) {
  const { rows, error, saving, save } = useRows<PluginRow>(
    () => bridge<PluginRow[]>("plugins", { game, profile }), [game, profile, reload]);
  const [warnings, setWarnings] = useState<string[]>([]);

  const sort = () => save(null, async () => {
    const result = await bridge<LootResult>("loot_sort", { game, profile });
    setWarnings(result.warnings);
    toast(result.moved ? `LOOT moved ${result.moved} plugin${result.moved === 1 ? "" : "s"}` : "LOOT: order already correct");
    return result.plugins;
  });

  if (error) return <Note>{error}</Note>;
  if (!rows) return <Loading text="Reading plugins…" />;

  const busy = locked || saving;
  return (
    <>
      <Focusable className="amd-bar" flow-children="horizontal">
        {loot && (
          <DialogButton className="amd-button-auto amd-min-200" disabled={busy} onClick={sort}>
            {saving ? "Working…" : "Sort with LOOT"}
          </DialogButton>
        )}
        <span className="amd-status amd-bar-text">
          The game loads these top to bottom.{loot ? " After installing mods, press Sort with LOOT." : ""}
          {" "}{rows.filter((plugin) => plugin.enabled).length} of {rows.length} active.
        </span>
      </Focusable>
      {warnings.map((warning, i) => <div key={i} className="amd-warn amd-warn-line">{warning}</div>)}
      {rows.length > 0 && !rows.some((plugin) => plugin.vanilla) && <BaseGameMissing game={game} />}
      {rows.length ? (
        <ReorderList<PluginRow>
          items={rows}
          keyOf={(plugin) => plugin.name}
          disabled={busy}
          rowClass={(plugin) => (plugin.vanilla || !plugin.enabled ? "amd-dim" : "")}
          canToggle={(plugin) => !plugin.vanilla}
          canMove={(plugin) => !plugin.vanilla}
          toggleLabel={(plugin) => (plugin.enabled ? "Disable" : "Enable")}
          onToggle={(plugin) => save(
            rows.map((x) => (x.name === plugin.name ? { ...x, enabled: !plugin.enabled } : x)),
            () => bridge<PluginRow[]>("set_plugin_enabled", { game, profile, name: plugin.name, enabled: !plugin.enabled }))}
          onMove={(plugin, to, order) => save(order,
            () => bridge<PluginRow[]>("move_plugin", { game, profile, name: plugin.name, to_index: to }))}
          renderRow={(plugin) => <PluginRowContent plugin={plugin} />}
        />
      ) : <Note>No plugins found. Enable some mods first.</Note>}
    </>
  );
}
