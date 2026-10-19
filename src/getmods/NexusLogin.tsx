import { DialogButton, Focusable, ModalRoot, showModal, TextField } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { Loading } from "../ui";
import { NexusStatus, bridge, errText, toast, useBridgeEvent } from "../shared";

/** The phone login page closes itself after 15 minutes (bridge side). */
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;

function qrSrc(url: string): string {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  return qr.createDataURL(6, 2);
}

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
      <div style={{ fontSize: 20, fontWeight: 600, paddingBottom: 8 }}>Nexus Mods API key</div>
      <div className="amd-sub" style={{ paddingBottom: 12 }}>
        Find it on nexusmods.com under Site preferences, API keys, Personal API Key. It's long, so the
        phone QR code is usually easier.
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
 * Not logged in to Nexus: show a QR code for the bridge's phone page where the
 * user pastes their Personal API key. The "nexus_login" event says it worked.
 */
export function NexusLogin({ status, onStatus }: { status: NexusStatus | null; onStatus: (s: NexusStatus) => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [round, setRound] = useState(0);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    setUrl("");
    setError("");
    setExpired(false);
    bridge<{ url: string }>("nexus_login_start").then(
      (r) => live.current && setUrl(r.url),
      (e) => live.current && setError(errText(e)));
    const timer = setTimeout(() => live.current && setExpired(true), LOGIN_TIMEOUT_MS);
    return () => {
      live.current = false;
      clearTimeout(timer);
    };
  }, [round]);

  // Close the phone page when the user leaves this screen.
  useEffect(() => () => { bridge("nexus_login_stop").catch(() => {}); }, []);

  useBridgeEvent((event, data) => {
    if (event === "nexus_login" && data?.logged_in) {
      toast(`Logged in to Nexus Mods as ${data.name ?? "you"}`);
      onStatus(data as NexusStatus);
    }
  });

  const typeKey = () => showModal(<KeyModal onDone={(s) => {
    toast(`Logged in to Nexus Mods as ${s.name ?? "you"}`);
    onStatus(s);
  }} />);

  return (
    <div style={{ display: "flex", gap: 24, padding: "8px 14px", alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ width: 240, height: 240, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(255,255,255,0.06)", borderRadius: 6 }}>
        {url && !expired ? (
          <img src={qrSrc(url)} style={{ width: 240, height: 240, imageRendering: "pixelated", borderRadius: 6 }} />
        ) : error ? (
          <div className="amd-err" style={{ padding: 12 }}>{error}</div>
        ) : expired ? (
          <div className="amd-sub" style={{ padding: 12, textAlign: "center" }}>This code has expired.</div>
        ) : <Loading text="Making a code…" />}
      </div>
      <div style={{ flex: 1, minWidth: 260, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Log in to Nexus Mods</div>
        {status?.error && <div className="amd-err">{status.error}</div>}
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.6 }}>
          <li>Scan the code with your phone (it must be on the same network as this device).</li>
          <li>Log in to Nexus Mods on your phone and copy your Personal API key.</li>
          <li>Paste it into the page and press Send.</li>
        </ol>
        {url && !expired && (
          <div style={{ fontSize: 16, fontFamily: "monospace", wordBreak: "break-all" }}>{url}</div>
        )}
        <div className="amd-sub">This screen switches over by itself once the key works.</div>
        <Focusable flow-children="horizontal" style={{ display: "flex", gap: 10, paddingTop: 6 }}>
          <DialogButton style={{ width: "auto", minWidth: 180 }} onClick={() => setRound((r) => r + 1)}>
            Show a new code
          </DialogButton>
          <DialogButton style={{ width: "auto", minWidth: 180 }} onClick={typeKey}>
            Type the key instead
          </DialogButton>
        </Focusable>
      </div>
    </div>
  );
}
