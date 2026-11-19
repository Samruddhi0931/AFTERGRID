import { useState } from "react";

import ResidentRequest from "./pages/ResidentRequest";
import GhostLineReceiver from "./components/GhostLineReceiver";
import CoordinatorDashboard from "./pages/CoordinatorDashboard";

import {
  generateSharedKey,
  importSharedKey,
} from "./services/sharedKey";

type View = "resident" | "ghostline" | "coordinator";

export default function App() {
  const [activeView, setActiveView] = useState<View>("resident");

  const [keyText, setKeyText] = useState("");
  const [encryptionKey, setEncryptionKey] =
    useState<CryptoKey | null>(null);

  const [feedback, setFeedback] = useState("");

  async function configureKey() {
    try {
      const key = await importSharedKey(keyText);

      setEncryptionKey(key);
      setFeedback("Shared key configured.");
    } catch (error) {
      setEncryptionKey(null);
      setFeedback(
        error instanceof Error
          ? error.message
          : "Invalid shared key"
      );
    }
  }

  function createKey() {
    setEncryptionKey(null);
    setKeyText(generateSharedKey());
    setFeedback(
      "New key generated. Configure it before use."
    );
  }

  const navButtonStyle = (view: View) => ({
    padding: "12px 20px",
    borderRadius: 10,
    border:
      activeView === view
        ? "1px solid #5dd6ca"
        : "1px solid #34435b",
    background:
      activeView === view ? "#174654" : "#101d30",
    color:
      activeView === view ? "#8ce8ed" : "#b8c9d9",
    fontWeight: 700,
    cursor: "pointer",
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#091424",
        color: "#e6edf7",
      }}
    >
      {/* Main Navigation */}
      <header
        style={{
          padding: "22px clamp(18px, 4vw, 56px)",
          borderBottom: "1px solid #293d53",
          background: "#0c1b2e",
        }}
      >
        <div
          style={{
            maxWidth: 1400,
            margin: "0 auto",
          }}
        >
          <div
            style={{
              color: "#5dd6ca",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 2,
              marginBottom: 8,
            }}
          >
            HAVEN / THE HOLLOW
          </div>

          <h1
            style={{
              margin: "0 0 18px",
              fontSize: 28,
              letterSpacing: -0.8,
            }}
          >
            Crisis Coordination Platform
          </h1>

          <nav
            aria-label="HAVEN sections"
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              aria-current={
                activeView === "resident" ? "page" : undefined
              }
              style={navButtonStyle("resident")}
              onClick={() => setActiveView("resident")}
            >
              Resident Portal
            </button>

            <button
              type="button"
              aria-current={
                activeView === "ghostline" ? "page" : undefined
              }
              style={navButtonStyle("ghostline")}
              onClick={() => setActiveView("ghostline")}
            >
              GhostLine Inbox
            </button>

            <button
              type="button"
              aria-current={
                activeView === "coordinator" ? "page" : undefined
              }
              style={navButtonStyle("coordinator")}
              onClick={() => setActiveView("coordinator")}
            >
              Command Center
            </button>
          </nav>
        </div>
      </header>

      {/* Shared Key Configuration */}
      {activeView !== "coordinator" && (
        <section
          style={{
            maxWidth: 1100,
            margin: "24px auto",
            padding: 20,
            background: "#101d30",
            color: "#e6edf7",
            border: "1px solid #293d53",
            borderRadius: 12,
          }}
        >
          <h2>GhostLine Shared Encryption Key</h2>

          <p>
            Both devices must configure the same key
            before transferring encrypted requests.
          </p>

          <input
            type="password"
            aria-label="Shared encryption key"
            value={keyText}
            onChange={(event) => {
              setKeyText(event.target.value);
              setEncryptionKey(null);
              setFeedback("");
            }}
            placeholder="Generate or enter a shared key"
            autoComplete="off"
            spellCheck={false}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: 12,
              marginTop: 12,
              background: "#091424",
              color: "white",
              border: "1px solid #34435b",
              borderRadius: 8,
            }}
          />

          <div
            style={{
              display: "flex",
              gap: 12,
              marginTop: 12,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={createKey}
            >
              Generate key
            </button>

            <button
              type="button"
              onClick={() => void configureKey()}
              disabled={!keyText.trim()}
            >
              Configure key
            </button>
          </div>

          <p role="status">{feedback}</p>

          <p>
            Status:{" "}
            {encryptionKey
              ? "Key ready"
              : "No key configured"}
          </p>

          <small>
            Demo only. The key stays in memory
            and must be re-entered after refresh.
            Provision it separately before a blackout.
            Do not send it alongside the encrypted QR.
          </small>
        </section>
      )}

      {/* Resident Portal */}
      {activeView === "resident" && (
        <ResidentRequest
          encryptionKey={encryptionKey}
        />
      )}

      {/* GhostLine Inbox */}
      {activeView === "ghostline" && (
        <div
          style={{
            maxWidth: 1100,
            margin: "24px auto 60px",
            padding: "0 16px",
          }}
        >
          <GhostLineReceiver
            encryptionKey={encryptionKey}
          />
        </div>
      )}

      {/* Coordinator Dashboard */}
      {activeView === "coordinator" && (
        <CoordinatorDashboard />
      )}
    </div>
  );
}
