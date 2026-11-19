import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import GhostLineScanner from "./GhostLineScanner";

import {
  db,
  importInboxMessage,
} from "../db/database";

import {
  parseEnvelope,
  decryptMessage,
} from "../services/crypto";

interface GhostLineReceiverProps {
  encryptionKey: CryptoKey | null;
}

export default function GhostLineReceiver({
  encryptionKey,
}: GhostLineReceiverProps) {
  // --------------------------------------------------
  // 1. Component State
  // --------------------------------------------------

  const [payload, setPayload] = useState("");
  const [feedback, setFeedback] = useState("");
  const [importing, setImporting] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  // Prevent simultaneous imports, including rapid scans.
  const importLock = useRef(false);

  // --------------------------------------------------
  // 2. Load Coordinator Inbox from IndexedDB
  // --------------------------------------------------

  const inbox = useLiveQuery(
    () =>
      db.inbox
        .orderBy("receivedAt")
        .reverse()
        .toArray(),
    []
  );

  // --------------------------------------------------
  // 3. Decrypt and Import Emergency Request
  // --------------------------------------------------

  async function importPayload(raw: string) {
    if (importLock.current) return;

    importLock.current = true;
    setImporting(true);
    setFeedback("");

    try {
      if (!encryptionKey) {
        throw new Error(
          "Configure the shared encryption key first."
        );
      }

      // Validate encrypted envelope.
      const envelope = parseEnvelope(raw.trim());

      // Decrypt and validate emergency request.
      const request = await decryptMessage(
        envelope,
        encryptionKey
      );

      // Save to IndexedDB.
      // Duplicate message IDs are rejected by database.ts.
      await importInboxMessage(request);

      setFeedback(
        "Encrypted request successfully decrypted and imported."
      );

      setPayload("");
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Unable to import encrypted request."
      );
    } finally {
      importLock.current = false;
      setImporting(false);
    }
  }

  // --------------------------------------------------
  // 4. Handle Camera QR Detection
  // --------------------------------------------------

  function handleScannedPayload(raw: string) {
    // Close the camera after detecting one QR code.
    setCameraOpen(false);

    // Keep the scanned payload visible if import fails.
    setPayload(raw);

    // Automatically decrypt and import.
    void importPayload(raw);
  }

  // --------------------------------------------------
  // 5. Coordinator Interface
  // --------------------------------------------------

  return (
    <section
      style={{
        padding: 24,
        border: "1px solid #34435b",
        borderRadius: 14,
        background: "#101d30",
        color: "#e6edf7",
      }}
    >
      <h2>GhostLine Coordinator Inbox</h2>

      <p>
        Scan an encrypted emergency QR code and import
        the request without contacting a server.
      </p>

      {/* Camera Controls */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          marginTop: 20,
        }}
      >
        <button
          type="button"
          disabled={!encryptionKey || importing}
          onClick={() => {
            setFeedback("");
            setCameraOpen((previous) => !previous);
          }}
        >
          {cameraOpen
            ? "Close camera"
            : "Scan QR code"}
        </button>
      </div>

      {/* Camera Scanner */}
      {cameraOpen && (
        <GhostLineScanner
          onScan={handleScannedPayload}
        />
      )}

      {/* Manual Payload Input */}
      <label
        htmlFor="ghostline-payload"
        style={{
          display: "block",
          marginTop: 20,
        }}
      >
        Or paste an encrypted payload
      </label>

      <textarea
        id="ghostline-payload"
        value={payload}
        onChange={(event) =>
          setPayload(event.target.value)
        }
        placeholder="Paste encrypted QR data here..."
        rows={5}
        spellCheck={false}
        style={{
          width: "100%",
          boxSizing: "border-box",
          marginTop: 8,
          padding: 12,
          background: "#091424",
          color: "#e6edf7",
          border: "1px solid #34435b",
          borderRadius: 8,
        }}
      />

      {/* Manual Import Button */}
      <button
        type="button"
        onClick={() => void importPayload(payload)}
        disabled={
          importing ||
          !encryptionKey ||
          !payload.trim()
        }
        style={{
          marginTop: 12,
          padding: "12px 18px",
          background: "#26b4c5",
          color: "#08111d",
          border: 0,
          borderRadius: 8,
          cursor: "pointer",
          fontWeight: 700,
        }}
      >
        {importing
          ? "Decrypting..."
          : "Decrypt and import"}
      </button>

      {/* Import Feedback */}
      {feedback && (
        <p
          role="status"
          style={{
            marginTop: 12,
            color: feedback.includes("successfully")
              ? "#80e4bb"
              : "#ff9b9b",
          }}
        >
          {feedback}
        </p>
      )}

      {/* Coordinator Inbox */}
      <h3 style={{ marginTop: 28 }}>
        Received requests ({inbox?.length ?? 0})
      </h3>

      {inbox === undefined ? (
        <p>Loading received requests...</p>
      ) : inbox.length === 0 ? (
        <p
          style={{
            marginTop: 12,
            color: "#9fb0c6",
          }}
        >
          No encrypted requests received yet.
        </p>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginTop: 12,
          }}
        >
          {inbox.map((item) => (
            <div
              key={item.id}
              style={{
                padding: 14,
                border: "1px solid #34435b",
                borderRadius: 10,
                background: "#091424",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <strong
                  style={{
                    color: "#80e4ed",
                  }}
                >
                  {item.request.resource.toUpperCase()}
                </strong>

                <span
                  style={{
                    color: "#e7c17a",
                    fontSize: 12,
                  }}
                >
                  {item.request.urgency.toUpperCase()}
                </span>
              </div>

              <p>
                {item.request.quantity} units
                {" · "}
                Level {item.request.level}
              </p>

              <p>
                Household: {item.request.householdId}
              </p>

              <small
                style={{
                  color: "#9fb0c6",
                }}
              >
                Received:{" "}
                {new Date(
                  item.receivedAt
                ).toLocaleString()}
              </small>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}