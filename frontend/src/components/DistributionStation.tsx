import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { collectReceipt, verifyCollectionToken } from "../services/rationosApi";
import type { CollectionDetails } from "../services/rationosApi";
import styles from "./DistributionStation.module.css";

interface Props { onCollected: () => Promise<void>; }

export default function DistributionStation({ onCollected }: Props) {
  const [token, setToken] = useState("");
  const [verified, setVerified] = useState<CollectionDetails | null>(null);
  const [completed, setCompleted] = useState<CollectionDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scanId = "haven-distribution-camera";

  async function stopScanner() {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner) {
      try { await scanner.stop(); } catch {
        // Scanner may not have started.
      }
      try { scanner.clear(); } catch {
        // Ignore scanner cleanup errors.
      }
    }
    setScanning(false);
  }

  useEffect(() => () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner) {
      void scanner.stop().catch(() => {
        // Scanner may already be stopped during unmount.
      }).then(() => {
        try {
          scanner.clear();
        } catch {
          // Ignore cleanup errors after unmount.
        }
      });
    }
  }, []);

  async function startScanner() {
    setError(""); setVerified(null); setCompleted(null);
    const scanner = new Html5Qrcode(scanId);
    scannerRef.current = scanner;
    try {
      await scanner.start(
        { facingMode: "environment" },
        { fps: 8, qrbox: { width: 230, height: 230 } },
        (decoded) => {
          setToken(decoded.trim());
          setVerified(null);
          setCompleted(null);
          void stopScanner();
        },
        () => {},
      );
      setScanning(true);
    } catch {
      scannerRef.current = null;
      try {
        scanner.clear();
      } catch {
        // Ignore cleanup errors when camera initialization fails.
      }
      setError("Camera unavailable. Allow camera access, or paste the receipt token instead.");
    }
  }

  async function verify() {
    if (!token.trim() || busy) return;
    setBusy(true); setError(""); setVerified(null); setCompleted(null);
    try { setVerified(await verifyCollectionToken(token.trim())); }
    catch (e) { setError(e instanceof Error ? e.message : "Verification failed"); }
    finally { setBusy(false); }
  }

  async function confirmCollection() {
    if (!verified || busy) return;
    if (!window.confirm(`Confirm physical handover of ${verified.quantity} ${verified.resource} units to ${verified.household_id}?`)) return;
    setBusy(true); setError("");
    try {
      const result = await collectReceipt(token.trim());
      setCompleted(result);
      setVerified(null);
      setToken(""); // Discard bearer token immediately after redemption.
      await onCollected();
    } catch (e) {
      setVerified(null);
      setError(e instanceof Error ? e.message : "Collection failed. Verify again.");
    } finally { setBusy(false); }
  }

  return (
    <section className={styles.station} aria-label="Distribution Station">
      <div className={styles.top}>
        <div><span className={styles.eyebrow}>AFTERGRID / DISTRIBUTION</span><h2>Distribution Station</h2>
          <p>Scan a resident's allocation QR, verify the entitlement, then confirm handover.</p></div>
        <span className={styles.tag}>Online verification required</span>
      </div>
      <div className={styles.layout}>
        <div className={styles.entry}>
          <div id={scanId} className={styles.camera} />
          <button className={styles.secondary} type="button" disabled={busy} onClick={() => void (scanning ? stopScanner() : startScanner())}>
            {scanning ? "Stop camera" : "Scan QR with camera"}
          </button>
          <label htmlFor="haven-collection-token">Or paste receipt token</label>
          <input id="haven-collection-token" type="password" autoComplete="off" value={token}
            placeholder="Paste token from receipt" onChange={(e) => { setToken(e.target.value); setVerified(null); setCompleted(null); setError(""); }} />
          <button className={styles.primary} type="button" disabled={!token.trim() || busy || scanning} onClick={() => void verify()}>
            {busy ? "Working..." : "Verify receipt"}
          </button>
        </div>
        <div className={styles.result}>
          {error && <p role="alert" className={styles.error}>{error}</p>}
          {completed ? (
            <div className={styles.success}><strong>Collection recorded</strong>
              <p>{completed.household_id} collected {completed.quantity} {completed.resource} unit(s).</p>
              <p>Receipt marked collected. No additional inventory deducted.</p></div>
          ) : verified ? (
            <div className={styles.verified}>
              <span className={styles.eyebrow}>VERIFIED · READY FOR HANDOVER</span>
              <h3>{verified.household_id}</h3>
              <p>Resource: <strong>{verified.resource}</strong></p>
              <p>Quantity: <strong>{verified.quantity}</strong></p>
              <p>Receipt: <code>{verified.receipt_id.slice(0, 8)}…</code></p>
              <p>Allocation ID: <code>{verified.allocation_id}</code></p>
              <p>Status: <strong>{verified.status}</strong></p>
              <button className={styles.primary} type="button" disabled={busy} onClick={() => void confirmCollection()}>
                Confirm resources handed over
              </button>
              <button className={styles.secondary} type="button" disabled={busy} onClick={() => { setVerified(null); setToken(""); }}>Cancel</button>
            </div>
          ) : (
            <div className={styles.placeholder}><strong>Awaiting receipt verification</strong>
              <p>Scanning or pasting a token never automatically redeems it. The coordinator confirms handover separately.</p></div>
          )}
        </div>
      </div>
    </section>
  );
}
