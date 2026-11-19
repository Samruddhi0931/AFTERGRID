import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import type { ResourceRequest } from "../schemas/message";

import {
  encryptMessage,
  serializeEnvelope,
} from "../services/crypto";

import styles from "./GhostLineQR.module.css";

interface GhostLineQRProps {
  request: ResourceRequest;
  encryptionKey: CryptoKey | null;
}

export default function GhostLineQR({
  request,
  encryptionKey,
}: GhostLineQRProps) {
  const [qrData, setQrData] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function generateQR() {
    if (!encryptionKey) {
      setError("Configure a shared key first.");
      return;
    }

    setLoading(true);
    setError("");
    setQrData("");

    try {
      const envelope = await encryptMessage(
        request,
        encryptionKey
      );

      setQrData(serializeEnvelope(envelope));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Encryption failed"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <button
        type="button"
        className={styles.button}
        onClick={generateQR}
        disabled={loading || !encryptionKey}
      >
        {loading
          ? "Encrypting..."
          : "Generate encrypted QR"}
      </button>

      {!encryptionKey && (
        <p className={styles.warning}>
          Configure a shared key to enable encryption.
        </p>
      )}

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      {qrData && (
        <div className={styles.qrPanel}>
          <div className={styles.qrSurface}>
            <QRCodeSVG
              value={qrData}
              size={260}
              level="M"
              marginSize={4}
            />
          </div>

          <p className={styles.caption}>
            GhostLine encrypted emergency message
          </p>

          <button
            type="button"
            className={styles.button}
            onClick={() =>
              navigator.clipboard
                .writeText(qrData)
                .catch(() =>
                  setError("Could not copy payload")
                )
            }
          >
            Copy encrypted payload
          </button>

          <p className={styles.warning}>
            The receiving device must have the same
            shared key. Never include the key in this QR.
          </p>
        </div>
      )}
    </div>
  );
}