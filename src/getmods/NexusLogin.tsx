import { DialogButton, Focusable, ModalRoot, Navigation, showModal, TextField } from "@decky/ui";
import { useState } from "react";
import { Styles } from "../ui";
import { NexusStatus, bridge, errText, toast, useBridgeEvent } from "../shared";

/** Fallback: type the Personal API key on the Deck with Steam's keyboard. */
function KeyModal({ closeModal, onDone }: { closeModal?: () => void; onDone: (status: NexusStatus) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (!key.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const status = await bridge<NexusStatus>("nexus_set_key", { key: key.trim() });
      if (status.logged_in) {
        onDone(status);
        closeModal?.();
      } else {
        setError(status.error || "Nexus didn't accept that key.");
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalRoot closeModal={closeModal} onCancel={closeModal}>
      <Styles />
      <div className="amd-modal-title">Nexus Mods API key</div>
      <div className="amd-sub amd-modal-intro">
        Find it on nexusmods.com under Site preferences, API keys, Personal API Key. It's long, so
        logging in through the browser is usually easier.
      </div>
      <Focusable flow-children="vertical" className="amd-stack amd-gap-10">
        <TextField label="Personal API key" value={key} bIsPassword focusOnMount disabled={busy}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }} />
        {error && <div className="amd-err">{error}</div>}
        <Focusable flow-children="horizontal" className="amd-hstack">
          <DialogButton disabled={busy || !key.trim()} onClick={save}>{busy ? "Checking…" : "Log in"}</DialogButton>
          <DialogButton disabled={busy} onClick={closeModal}>Cancel</DialogButton>
        </Focusable>
      </Focusable>
    </ModalRoot>
  );
}

/**
 * Not logged in to Nexus: open Nexus's authorise page in Steam's browser
 * (Amethyst's own login). The "nexus_login" event says when it worked or failed.
 */
export function NexusLogin({ status, onStatus }: { status: NexusStatus | null; onStatus: (status: NexusStatus) => void }) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");

  useBridgeEvent((event, data) => {
    if (event !== "nexus_login") return;
    setWaiting(false);
    if (data?.logged_in) {
      onStatus(data as NexusStatus);   // the toast comes from index.tsx
    } else if (data?.error) {
      setError(data.error);
    }
  });

  const login = async () => {
    setError("");
    try {
      const { url } = await bridge<{ url: string }>("nexus_login_start");
      setWaiting(true);
      Navigation.NavigateToExternalWeb(url);
    } catch (e) {
      setError(errText(e));
    }
  };

  const typeKey = () => showModal(<KeyModal onDone={(loggedIn) => {
    toast(`Logged in to Nexus Mods as ${loggedIn.name ?? "you"}`);
    onStatus(loggedIn);
  }} />);

  return (
    <div className="amd-section amd-narrow">
      <div className="amd-title-medium">Log in to Nexus Mods</div>
      {(error || status?.error) && <div className="amd-err">{error || status?.error}</div>}
      <ol className="amd-steps">
        <li>Press Log in. Nexus opens in Steam's browser.</li>
        <li>Sign in if it asks (the first time only), then press Authorize.</li>
        <li>Come back here. This screen switches over by itself.</li>
      </ol>
      {waiting && <div className="amd-sub">Waiting for you to press Authorize in the browser…</div>}
      <Focusable flow-children="horizontal" className="amd-hstack amd-space-above">
        <DialogButton className="amd-button-auto amd-min-180" onClick={login}>
          {waiting ? "Open the page again" : "Log in"}
        </DialogButton>
        <DialogButton className="amd-button-auto amd-min-180" onClick={typeKey}>
          Type the key instead
        </DialogButton>
      </Focusable>
    </div>
  );
}
