import { QRCodeSVG } from "qrcode.react";
import type { IssuedReceipt } from "../services/rationosApi";
import styles from "./AllocationReceiptQR.module.css";

interface Props {
  receipt: IssuedReceipt;
}

export default function AllocationReceiptQR({ receipt }: Props) {
  // The opaque token is the only QR payload. Do not embed household details.
  function printReceipt() {
    const svg = document.getElementById(`haven-qr-${receipt.receipt_id}`);
    if (!svg) return;
    const popup = window.open("", "_blank", "width=520,height=720");
    if (!popup) { window.alert("Allow popups to print the receipt."); return; }
    const doc = popup.document;
    doc.title = "HAVEN Allocation Receipt";
    const style = doc.createElement("style");
    style.textContent = "body{font-family:Arial,sans-serif;padding:32px;text-align:center;color:#13232b}svg{display:block;margin:20px auto}p{margin:12px 0}";
    doc.head.appendChild(style);
    const title = doc.createElement("h2"); title.textContent = "HAVEN · Allocation Receipt"; doc.body.appendChild(title);
    const copy = svg.cloneNode(true); doc.body.appendChild(copy);
    for (const line of [`Household: ${receipt.household_id}`, `Resource: ${receipt.resource}`, `Quantity: ${receipt.quantity}`, "Keep private. Valid for one collection."]) {
      const p = doc.createElement("p"); p.textContent = line; doc.body.appendChild(p);
    }
    popup.focus();
    popup.print();
  }

  function saveReceipt() {
    const svg = document.getElementById(`haven-qr-${receipt.receipt_id}`);
    if (!svg) return;
    const data = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([data], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `haven-receipt-${receipt.receipt_id}.svg`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <article className={styles.receipt}>
      <div className={styles.heading}>
        <span className={styles.eyebrow}>HAVEN / DISTRIBUTION</span>
        <h3>Allocation Receipt</h3>
        <p>Present this QR code at the distribution station.</p>
      </div>

      <div className={styles.qrFrame}>
        <QRCodeSVG
          id={`haven-qr-${receipt.receipt_id}`}
          value={receipt.token}
          size={188}
          marginSize={2}
          level="H"
          bgColor="#FFFFFF"
          fgColor="#10242B"
        />
      </div>

      <div className={styles.details}>
        <div>
          <span>Household</span>
          <strong>{receipt.household_id}</strong>
        </div>
        <div>
          <span>Resource</span>
          <strong>{receipt.resource}</strong>
        </div>
        <div>
          <span>Approved quantity</span>
          <strong>{receipt.quantity}</strong>
        </div>
        <div>
          <span>Status</span>
          <strong>Issued · Not collected</strong>
        </div>
      </div>

      <p className={styles.warning}>
        This QR code is a bearer credential. Keep it private.
        It can be used to claim the approved resources once
        collection verification is enabled.
      </p>

      <button
        type="button"
        className={styles.printButton}
        onClick={printReceipt}
      >
        Print receipt
      </button>
      <button type="button" className={styles.printButton} onClick={saveReceipt}>
        Save QR (SVG)
      </button>
    </article>
  );
}
