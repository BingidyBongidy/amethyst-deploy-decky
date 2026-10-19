import { DialogButton, Focusable, ModalRoot, Navigation, showModal, TextField } from "@decky/ui";
import { useEffect, useState } from "react";
import { Styles } from "../ui";
import { NexusStatus, bridge, errText, toast, useBridgeEvent } from "../shared";

/** Fallback: type the Personal API key on the Deck with Steam's keyboard. */
function KeyModal({ closeModal, onDone }: { closeModal?: () => void; onDone: (s: NexusStatus) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (!key.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const s = await bridge<NexusStatus>("nexus_set_key", { key: key.trim() });
      if (s.logged_in) {
        onDone(s);
        closeModal?.();
      } else {
        setError(s.error || "Nexus didn't accept that key.");
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
      <div style={{ fontSize: 20, fontWeight: 600, paddingBottom: 8 }}>Nexus Mods API key</div>
      <div className="amd-sub" style={{ paddingBottom: 12 }}>
        Find it on nexusmods.com under Site preferences, API keys, Personal API Key. It's long, so
        logging in through the browser is usually easier.
      </div>
      <Focusable flow-children="vertical" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <TextField label="Personal API key" value={key} bIsPassword focusOnMount disabled={busy}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
        {error && <div className="amd-err">{error}</div>}
        <Focusable flow-children="horizontal" style={{ display: "flex", gap: 10 }}>
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
export function NexusLogin({ status, onStatus }: { status: NexusStatus | null; onStatus: (s: NexusStatus) => void }) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");

  // Stop waiting for the browser when the user leaves this screen.
  useEffect(() => () => { bridge("nexus_login_stop").catch(() => {}); }, []);

  useBridgeEvent((event, data) => {
    if (event !== "nexus_login") return;
    setWaiting(false);
    if (data?.logged_in) {
      toast(`Logged in to Nexus Mods as ${data.name ?? "you"}`);
      onStatus(data as NexusStatus);
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

  const typeKey = () => showModal(<KeyModal onDone={(s) => {
    toast(`Logged in to Nexus Mods as ${s.name ?? "you"}`);
    onStatus(s);
  }} />);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 14px", maxWidth: 720 }}>
      <div style={{ fontSize: 18, fontWeight: 600 }}>Log in to Nexus Mods</div>
      {(error || status?.error) && <div className="amd-err">{error || status?.error}</div>}
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.6 }}>
        <li>Press Log in. Nexus opens in Steam's browser.</li>
        <li>Sign in if it asks (the first time only), then press Authorize.</li>
        <li>Come back here. This screen switches over by itself.</li>
      </ol>
      {waiting && <div className="amd-sub">Waiting for you to press Authorize in the browser…</div>}
      <Focusable flow-children="horizontal" style={{ display: "flex", gap: 10, paddingTop: 6 }}>
        <DialogButton style={{ width: "auto", minWidth: 180 }} onClick={login}>
          {waiting ? "Open the page again" : "Log in"}
        </DialogButton>
        <DialogButton style={{ width: "auto", minWidth: 180 }} onClick={typeKey}>
          Type the key instead
        </DialogButton>
      </Focusable>
    </div>
  );
}
