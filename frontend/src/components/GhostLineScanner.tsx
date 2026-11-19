import { useEffect, useId, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

interface GhostLineScannerProps {
  onScan: (payload: string) => void;
}

export default function GhostLineScanner({
  onScan,
}: GhostLineScannerProps) {
  const reactId = useId();
  const scannerId = `ghostline-scanner-${reactId.replace(/:/g, "")}`;

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onScanRef = useRef(onScan);
  const detectedRef = useRef(false);

  const [scanning, setScanning] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    let disposed = false;
    let scanner: Html5Qrcode | null = null;

    async function startCamera() {
      try {
        scanner = new Html5Qrcode(scannerId, {
          verbose: false,
        });

        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
          },
          (decodedText) => {
            if (detectedRef.current) return;

            detectedRef.current = true;
            onScanRef.current(decodedText);
          },
          () => {
            // Ignore ordinary frames without QR codes.
          }
        );

        if (disposed) {
          await scanner.stop();
          scanner.clear();
          return;
        }

        setScanning(true);
        setFeedback("Camera ready. Point it at a GhostLine QR.");
      } catch (error) {
        if (!disposed) {
          setFeedback(
            error instanceof Error
              ? error.message
              : "Unable to start camera."
          );
        }

        if (scanner) {
          try {
            scanner.clear();
          } catch {
            // Scanner may not have initialized fully.
          }
        }
      }
    }

    void startCamera();

    return () => {
      disposed = true;

      const activeScanner = scannerRef.current;
      scannerRef.current = null;

      if (activeScanner) {
        void (async () => {
          try {
            if (activeScanner.isScanning) {
              await activeScanner.stop();
            }
            activeScanner.clear();
          } catch (error) {
            console.error("Camera cleanup failed:", error);
          }
        })();
      }
    };
  }, [scannerId]);

  return (
    <div style={{ marginTop: 16 }}>
      <div
        id={scannerId}
        style={{
          width: "100%",
          maxWidth: 380,
          overflow: "hidden",
          borderRadius: 12,
          background: "#091424",
        }}
      />

      <p role="status" style={{ marginTop: 10 }}>
        {feedback}
      </p>

      {scanning && (
        <p style={{ fontSize: 12, color: "#9fb0c6" }}>
          Scan one QR code at a time. The camera closes
          when a code is detected.
        </p>
      )}
    </div>
  );
}