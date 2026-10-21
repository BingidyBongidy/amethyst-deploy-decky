import { ConfirmModal, showModal, TextField } from "@decky/ui";
import { useState } from "react";
import { bridge, errText, toast } from "../shared";

function NewProfileModal({ game, closeModal, onCreated }: {
  game: string; closeModal?: () => void; onCreated: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const create = async () => {
    try {
      await bridge("create_profile", { game, name: name.trim() });
      toast(`Created profile ${name.trim()}`);
      onCreated(name.trim());
    } catch (e) {
      toast(errText(e));
    }
  };
  return (
    <ConfirmModal
      strTitle={`New profile for ${game}`}
      strOKButtonText="Create"
      bOKDisabled={!name.trim()}
      closeModal={closeModal}
      onOK={create}
    >
      <TextField label="Profile name" focusOnMount value={name} onChange={(e) => setName(e.target.value)} />
    </ConfirmModal>
  );
}

/** Ask for a profile name and create it (bridge: create_profile). */
export const askNewProfile = (game: string, onCreated: (name: string) => void) =>
  showModal(<NewProfileModal game={game} onCreated={onCreated} />);
