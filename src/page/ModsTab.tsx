import { ConfirmModal, showModal } from "@decky/ui";
import { FaLock } from "react-icons/fa";
import { ReorderList } from "../ReorderList";
import { Check, Loading, Note, useRows } from "../ui";
import { Mod, bridge } from "../shared";
import type { TabContext } from "./types";

function modRowClass(mod: Mod): string {
  if (mod.separator) return "amd-sep";
  return mod.enabled ? "" : "amd-dim";
}

function ModRow({ mod }: { mod: Mod }) {
  if (mod.separator) return <span className="amd-name">{mod.label}</span>;
  return (
    <>
      <Check on={mod.enabled} />
      <span className="amd-name">{mod.label}</span>
      {mod.locked && <FaLock className="amd-tag" />}
    </>
  );
}

/** The profile's mods in priority order: A enables/disables, X moves, Y uninstalls. */
export function ModsTab({ game, profile, locked, reload }: TabContext) {
  const { rows, error, saving, save } = useRows<Mod>(
    () => bridge<Mod[]>("mods", { game, profile }), [game, profile, reload]);

  if (error) return <Note>{error}</Note>;
  if (!rows) return <Loading text="Reading mod list…" />;
  if (!rows.length) return <Note>No mods in this profile yet. Installing mods comes in a later update; use Amethyst in Desktop Mode for now.</Note>;

  const mods = rows.filter((mod) => !mod.separator);
  const uninstall = (mod: Mod) => showModal(
    <ConfirmModal strTitle={`Uninstall ${mod.label}?`}
      strDescription="This removes the mod's files from every profile. You can reinstall it later."
      strOKButtonText="Uninstall" bDestructiveWarning
      onOK={() => save(rows.filter((x) => x.name !== mod.name),
        () => bridge<Mod[]>("remove_mod", { game, profile, name: mod.name }))} />);
  const toggle = (mod: Mod) => save(
    rows.map((x) => (x.name === mod.name ? { ...x, enabled: !mod.enabled } : x)),
    () => bridge<Mod[]>("set_mod_enabled", { game, profile, name: mod.name, enabled: !mod.enabled }));

  return (
    <>
      <div className="amd-status">
        {mods.filter((mod) => mod.enabled).length} of {mods.length} enabled · top of the list wins conflicts
        {saving && " · saving…"}
      </div>
      <ReorderList<Mod>
        items={rows}
        keyOf={(mod) => mod.name}
        disabled={locked || saving}
        rowClass={modRowClass}
        canToggle={(mod) => !mod.separator && !mod.locked}
        canMove={() => true}
        toggleLabel={(mod) => (mod.enabled ? "Disable" : "Enable")}
        optionLabel={(mod) => (mod.separator ? undefined : "Uninstall")}
        onOption={uninstall}
        onToggle={toggle}
        onMove={(mod, to, order) => save(order,
          () => bridge<Mod[]>("move_mod", { game, profile, name: mod.name, to_index: to }))}
        renderRow={(mod) => <ModRow mod={mod} />}
      />
    </>
  );
}
