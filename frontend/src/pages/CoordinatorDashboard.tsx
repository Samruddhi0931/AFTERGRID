import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";


import { db } from "../db/database";

import {
  approveDraft,
  calculateAllocation,
  fetchApprovals,
  fetchInventory,
  fetchAllocationReceipts,
  issueAllocationReceipts,
  fetchServerRequests,
  rejectDraft,
  reissueAllocationReceipt,
  syncRequest,
  updateInventory,
} from "../services/rationosApi";

import type {
  AllocationResult,
  ApprovalRecord,
  InventoryItem,
  Resource,
  ReceiptListResult,
  IssuedReceipt,
  ServerRequest,
} from "../services/rationosApi";

import AllocationReceiptQR from "../components/AllocationReceiptQR";
import DistributionStation from "../components/DistributionStation";
import styles from "./CoordinatorDashboard.module.css";

const RESOURCES: Resource[] = [
  "food",
  "water",
  "medicine",
];

export default function CoordinatorDashboard() {
  // --------------------------------------------------
  // 1. Local GhostLine Inbox
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
  // 2. Backend Data
  // --------------------------------------------------

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [serverRequests, setServerRequests] = useState<ServerRequest[]>([]);
  const [draft, setDraft] = useState<AllocationResult | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [receiptMetadata, setReceiptMetadata] = useState<Record<string, ReceiptListResult>>({});
  // Raw bearer tokens live in component memory only and are discarded on close.
  const [issuedReceipts, setIssuedReceipts] = useState<IssuedReceipt[]>([]);
  const [receiptApprovalId, setReceiptApprovalId] = useState<string | null>(null);
  const [receiptBusyId, setReceiptBusyId] = useState<string | null>(null);
  const [viewReceiptApprovalId, setViewReceiptApprovalId] = useState<string | null>(null);
  const [reissueReceiptId, setReissueReceiptId] = useState<string | null>(null);
  const [reissueReason, setReissueReason] = useState("");

  const [stock, setStock] = useState<Record<Resource, string>>({
    food: "0",
    water: "0",
    medicine: "0",
  });

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [online, setOnline] = useState(false);

  // --------------------------------------------------
  // 3. Refresh Backend Data
  // --------------------------------------------------

  async function refresh() {
    try {
      const [inventoryData, requestData, approvalData] = await Promise.all([
        fetchInventory(),
        fetchServerRequests(),
        fetchApprovals(),
      ]);
      // Old pending drafts may be stale. Only a newly generated draft is actionable.
      setDraft(null);
      setApprovals(approvalData);
      const metadata = await Promise.all(approvalData.map(async (approval) => {
        try {
          return [approval.approval_id, await fetchAllocationReceipts(approval.approval_id)] as const;
        } catch {
          return null;
        }
      }));
      setReceiptMetadata(Object.fromEntries(metadata.filter((item): item is NonNullable<typeof item> => item !== null)));

      setInventory(inventoryData);
      setServerRequests(requestData);
      setOnline(true);

      setStock((previous) => {
        const updated = { ...previous };

        for (const item of inventoryData) {
          updated[item.resource] = String(item.available);
        }

        return updated;
      });
    } catch (error) {
      setOnline(false);
      throw error;
    }
  }

  // --------------------------------------------------
  // 4. Initial Backend Connection
  // --------------------------------------------------

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [inventoryData, requestData, approvalData] = await Promise.all([
          fetchInventory(),
          fetchServerRequests(),
            fetchApprovals(),
        ]);

        if (!active) return;

        setInventory(inventoryData);
        setServerRequests(requestData);
        // Old pending drafts may be stale. Only a newly generated draft is actionable.
        setDraft(null);
        setApprovals(approvalData);
        const metadata = await Promise.all(approvalData.map(async (approval) => {
          try {
            return [approval.approval_id, await fetchAllocationReceipts(approval.approval_id)] as const;
          } catch {
            return null;
          }
        }));
        if (!active) return;
        setReceiptMetadata(Object.fromEntries(metadata.filter((item): item is NonNullable<typeof item> => item !== null)));
        setOnline(true);

        setStock((previous) => {
          const updated = { ...previous };

          for (const item of inventoryData) {
            updated[item.resource] = String(item.available);
          }

          return updated;
        });
      } catch {
        if (active) {
          setOnline(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  // --------------------------------------------------
  // 5. Dashboard Statistics
  // --------------------------------------------------

  const serverIds = new Set(
    serverRequests.map((item) => item.message_id)
  );

  const pending = (inbox ?? []).filter(
    (item) => !serverIds.has(item.id)
  );

  const totalStock = inventory.reduce(
    (sum, item) => sum + item.available,
    0
  );

  // --------------------------------------------------
  // 6. Shared Async Action Handler
  // --------------------------------------------------

  async function runAction(action: () => Promise<void>) {
    if (busy) return;

    setBusy(true);
    setFeedback("");

    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Operation failed.";
      if (/stale|no positive allocations|draft differs|draft is not pending/i.test(message)) {
        setDraft(null);
        setConfirming(false);
      }
      setFeedback(message);
    } finally {
      setBusy(false);
    }
  }

  // --------------------------------------------------
  // 7. Update Resource Inventory
  // --------------------------------------------------

  function saveStock(resource: Resource) {
    void runAction(async () => {
      const raw = stock[resource].trim();
      const value = Number(raw);

      if (
        raw === "" ||
        !Number.isSafeInteger(value) ||
        value < 0
      ) {
        throw new Error(
          "Stock must be a non-negative whole number."
        );
      }

      await updateInventory(resource, value);

      // Existing allocation is now stale.
      setDraft(null);

      await refresh();

      setFeedback(
        `${resource} inventory updated successfully.`
      );
    });
  }

  // --------------------------------------------------
  // 8. Synchronize GhostLine Requests
  // --------------------------------------------------

  function synchronize() {
    void runAction(async () => {
      let imported = 0;
      let alreadyExists = 0;

      for (const item of pending) {
        try {
          await syncRequest(item.request);
          imported++;
        } catch (error) {
          if (
            error instanceof Error &&
            error.message ===
              "Request already synchronized."
          ) {
            alreadyExists++;
          } else {
            throw error;
          }
        }
      }

      // New requests invalidate the previous allocation.
      setDraft(null);

      await refresh();

      setFeedback(
        `Synchronized ${imported} requests. ` +
          `${alreadyExists} already existed.`
      );
    });
  }

  // --------------------------------------------------
  // 9. Run RationOS Optimization
  // --------------------------------------------------

  function runSolver() {
    void runAction(async () => {
      const result = await calculateAllocation();

      setDraft(result);

      setFeedback(
        "Allocation calculated successfully. " +
          "This is a draft, not an approved distribution."
      );
    });
  }

  // --------------------------------------------------
  // 10. Coordinator decisions
  // --------------------------------------------------

  function approveCurrentDraft() {
    if (!draft || draft.status !== "pending") return;
    const id = draft.draft_id;
    setConfirming(false);
    void runAction(async () => {
      const result = await approveDraft(id);
      await refresh();
      setFeedback(`Allocation approved. Approval ID: ${result.approval_id}`);
    });
  }

  function rejectCurrentDraft() {
    if (!draft || draft.status !== "pending") return;
    const id = draft.draft_id;
    setConfirming(false);
    void runAction(async () => {
      await rejectDraft(id);
      await refresh();
      setFeedback("Draft rejected. Inventory was not deducted.");
    });
  }

  // --------------------------------------------------
  // 11. One-time allocation receipt issuance
  // --------------------------------------------------

  function issueReceipts(approvalId: string) {
    if (busy || receiptBusyId) return;
    void runAction(async () => {
      setReceiptBusyId(approvalId);
      try {
        // Check the server before attempting to issue one-time bearer tokens.
        const existing = await fetchAllocationReceipts(approvalId);
        setReceiptMetadata((prev) => ({ ...prev, [approvalId]: existing }));
        if (existing.receipt_count > 0) {
          throw new Error("Receipts already issued. Their secret tokens cannot be recovered; use your securely saved originals.");
        }
        const issued = await issueAllocationReceipts(approvalId);
        setIssuedReceipts(issued.receipts);
        setReceiptApprovalId(approvalId);
        setReceiptMetadata((prev) => ({
          ...prev,
          [approvalId]: {
            approval_id: approvalId,
            receipt_count: issued.receipt_count,
            receipts: issued.receipts.map((receipt) => ({
              receipt_id: receipt.receipt_id,
              allocation_id: receipt.allocation_id,
              message_id: receipt.message_id,
              status: receipt.status,
              issued_at: new Date().toISOString(),
              collected_at: null,
            })),
          },
        }));
        setFeedback(`Issued ${issued.receipt_count} receipts. Print or save them before closing this panel; tokens cannot be recovered.`);
      } finally {
        setReceiptBusyId(null);
      }
    });
  }

  function viewReceiptStatus(approvalId: string) {
    setViewReceiptApprovalId((previous) => previous === approvalId ? null : approvalId);
    void runAction(async () => {
      const metadata = await fetchAllocationReceipts(approvalId);
      setReceiptMetadata((prev) => ({ ...prev, [approvalId]: metadata }));
    });
  }

  function reissueReceipt(receiptId: string, approvalId: string) {
    if (reissueReason.trim().length < 8) {
      setFeedback("Provide a reason of at least 8 characters for the audit log.");
      return;
    }
    if (!window.confirm("Reissue this receipt? The previous QR token will be invalidated immediately. Continue only after verifying the household's identity.")) return;
    void runAction(async () => {
      const result = await reissueAllocationReceipt(receiptId, reissueReason.trim());
      setIssuedReceipts([result.receipt]);
      setReceiptApprovalId(approvalId);
      setReissueReceiptId(null);
      setReissueReason("");
      const metadata = await fetchAllocationReceipts(approvalId);
      setReceiptMetadata((prev) => ({ ...prev, [approvalId]: metadata }));
      setFeedback("Replacement QR issued. The old token is invalid. Save or print the new QR now.");
    });
  }

  function closeReceiptPanel() {
    if (!window.confirm("Close the receipt display? Raw tokens will be lost from this page. Make sure you have securely saved or printed every receipt.")) return;
    setIssuedReceipts([]);
    setReceiptApprovalId(null);
  }

  // --------------------------------------------------
  // 10. Render Dashboard
  // --------------------------------------------------

  return (
    <main className={styles.dashboard}>
      {/* Dashboard Header */}
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>
            AFTERGRID / RATIONOS
          </div>

          <h1>Command Center</h1>

          <p>
            Resource coordination for The Hollow
          </p>
        </div>

        <span
          className={
            online ? styles.online : styles.offline
          }
        >
          <span className={styles.statusDot} />

          {online
            ? "Backend connected"
            : "Backend unavailable"}
        </span>
      </header>

      {/* KPI Cards */}
      <section className={styles.metrics}>
        <article className={styles.metric}>
          <span>Emergency requests</span>

          <strong>
            {serverRequests.length}
          </strong>

          <small>
            Stored on coordinator backend
          </small>
        </article>

        <article className={styles.metric}>
          <span>Available inventory</span>

          <strong>{totalStock}</strong>

          <small>
            Units across all resources
          </small>
        </article>

        <article className={styles.metric}>
          <span>Pending synchronization</span>

          <strong>{pending.length}</strong>

          <small>
            Requests in local GhostLine inbox
          </small>
        </article>

        <article className={styles.metric}>
          <span>Allocation status</span>

          <strong className={styles.statusValue}>
            {draft ? "Pending" : approvals.length ? "Approved" : "Not run"}
          </strong>

          <small>
            Human approval required
          </small>
        </article>
      </section>

      {/* Inventory + Synchronization */}
      <div className={styles.columns}>
        {/* Resource Inventory */}
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Resource Inventory</h2>

              <p>
                Available stock in the settlement
              </p>
            </div>
          </div>

          {RESOURCES.map((resource) => (
            <div
              className={styles.inventoryRow}
              key={resource}
            >
              <div>
                <strong className={styles.capitalize}>
                  {resource}
                </strong>

                <small>
                  {inventory.find(
                    (item) =>
                      item.resource === resource
                  )?.available ?? 0}{" "}
                  available
                </small>
              </div>

              <div className={styles.inventoryControls}>
                <input
                  aria-label={`${resource} stock`}
                  type="number"
                  min="0"
                  step="1"
                  value={stock[resource]}
                  onChange={(event) =>
                    setStock((previous) => ({
                      ...previous,
                      [resource]:
                        event.target.value,
                    }))
                  }
                />

                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    saveStock(resource)
                  }
                >
                  Save
                </button>
              </div>
            </div>
          ))}
        </section>

        {/* GhostLine Synchronization */}
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>
                GhostLine Synchronization
              </h2>

              <p>
                Move validated offline requests
                into RationOS
              </p>
            </div>
          </div>

          <div className={styles.syncStats}>
            <div>
              <strong>
                {inbox?.length ?? 0}
              </strong>

              <span>Local inbox</span>
            </div>

            <div>
              <strong>
                {pending.length}
              </strong>

              <span>Pending</span>
            </div>
          </div>

          <button
            type="button"
            className={styles.primaryButton}
            disabled={
              busy || pending.length === 0
            }
            onClick={synchronize}
          >
            {busy
              ? "Working..."
              : "Sync pending requests"}
          </button>

          <p className={styles.hint}>
            Decrypted requests are sent to the
            configured coordinator backend only
            when synchronization is triggered.
          </p>
        </section>
      </div>

      {/* Fair Allocation */}
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>
              Fair Resource Allocation
            </h2>

            <p>
              OR-Tools optimization compared with
              first-come-first-served
            </p>
          </div>

          <button
            type="button"
            className={styles.primaryButton}
            disabled={busy || !online}
            onClick={runSolver}
          >
            {busy
              ? "Calculating..."
              : "Run RationOS"}
          </button>
        </div>

        {!draft ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              ◎
            </div>

            <h3>
              No allocation calculated
            </h3>

            <p>
              Configure inventory,
              synchronize requests, and run
              RationOS to generate a draft.
            </p>
          </div>
        ) : (
          <div className={styles.results}>
            <div className={styles.draftNotice}>
              Draft proposal — no inventory
              has been deducted.
              Coordinator approval is required.
            </div>

            {draft.status === "pending" && (
              <div className={styles.approvalControls}>
                <div>
                  <strong>Coordinator decision required</strong>
                  <p>Draft ID: <code>{draft.draft_id}</code></p>
                  <p>Approval commits the proposed quantities to inventory. Rejection leaves stock unchanged.</p>
                </div>
                <div className={styles.approvalActions}>
                  <button type="button" disabled={busy} className={styles.approveButton} onClick={() => setConfirming(true)}>
                    Approve allocation
                  </button>
                  <button type="button" disabled={busy} className={styles.rejectButton} onClick={rejectCurrentDraft}>
                    Reject draft
                  </button>
                </div>
                {confirming && (
                  <div className={styles.confirmPanel} role="alertdialog" aria-label="Confirm allocation approval" aria-modal="false">
                    <strong>Confirm allocation approval?</strong>
                    <p>This will commit {RESOURCES.reduce((sum, resource) => sum + draft.resources[resource].optimized.allocated, 0)} units and update inventory. This action cannot be undone from the dashboard.</p>
                    <div className={styles.approvalActions}>
                      <button type="button" disabled={busy} className={styles.approveButton} onClick={approveCurrentDraft}>Yes, approve</button>
                      <button type="button" disabled={busy} className={styles.rejectButton} onClick={() => setConfirming(false)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {RESOURCES.map((resource) => {
              const result =
                draft.resources[resource];

              const optimized =
                result.optimized;

              const baseline =
                result.baseline;

              return (
                <article
                  className={
                    styles.resourceResult
                  }
                  key={resource}
                >
                  <div
                    className={
                      styles.resultHeading
                    }
                  >
                    <h3
                      className={
                        styles.capitalize
                      }
                    >
                      {resource}
                    </h3>

                    <span>
                      {optimized.allocated} /{" "}
                      {optimized.available} units
                      allocated
                    </span>
                  </div>

                  {optimized.allocations.length ===
                  0 ? (
                    <p className={styles.hint}>
                      No requests for this
                      resource.
                    </p>
                  ) : (
                    <>
                      {/* Fairness Comparison */}
                      <div
                        className={
                          styles.comparison
                        }
                      >
                        <div>
                          <span>
                            RationOS minimum
                            fulfillment
                          </span>

                          <strong>
                            {
                              optimized.fairness_score
                            }
                            %
                          </strong>
                        </div>

                        <div>
                          <span>
                            First-come minimum
                            fulfillment
                          </span>

                          <strong>
                            {
                              baseline.fairness_score
                            }
                            %
                          </strong>
                        </div>
                      </div>

                      {/* Allocation Rows */}
                      <div
                        className={
                          styles.allocationList
                        }
                      >
                        {optimized.allocations.map(
                          (item) => {
                            const baselineItem =
                              baseline.allocations.find(
                                (entry) =>
                                  entry.message_id ===
                                  item.message_id
                              );

                            return (
                              <div
                                className={
                                  styles.allocationRow
                                }
                                key={
                                  item.message_id
                                }
                              >
                                <div
                                  className={
                                    styles.allocationLabel
                                  }
                                >
                                  <strong>
                                    {
                                      item.household_id
                                    }
                                  </strong>

                                  <span>
                                    {item.urgency ??
                                      "normal"}
                                    {" · "}
                                    requested{" "}
                                    {
                                      item.requested
                                    }
                                  </span>
                                </div>

                                {/* Allocation Bars */}
                                <div
                                  className={
                                    styles.bars
                                  }
                                >
                                  <div
                                    className={
                                      styles.barTrack
                                    }
                                  >
                                    <div
                                      className={
                                        styles.optimizedBar
                                      }
                                      style={{
                                        width: `${item.fulfillment_percent}%`,
                                      }}
                                    />
                                  </div>

                                  <div
                                    className={
                                      styles.barTrack
                                    }
                                  >
                                    <div
                                      className={
                                        styles.baselineBar
                                      }
                                      style={{
                                        width: `${
                                          baselineItem?.fulfillment_percent ??
                                          0
                                        }%`,
                                      }}
                                    />
                                  </div>
                                </div>

                                {/* Allocation Numbers */}
                                <div
                                  className={
                                    styles.allocationNumbers
                                  }
                                >
                                  <strong>
                                    {item.allocated}
                                  </strong>

                                  <small>
                                    vs{" "}
                                    {baselineItem?.allocated ??
                                      0}
                                  </small>
                                </div>
                              </div>
                            );
                          }
                        )}
                      </div>

                      {/* Chart Legend */}
                      <div className={styles.legend}>
                        <span>
                          <i
                            className={
                              styles.optimizedLegend
                            }
                          />
                          RationOS
                        </span>

                        <span>
                          <i
                            className={
                              styles.baselineLegend
                            }
                          />
                          First-come
                        </span>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <DistributionStation onCollected={refresh} />

      {/* Persistent approval history */}
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>Approval History</h2>
            <p>Recorded human decisions and committed allocations</p>
          </div>
          <button type="button" disabled={busy || !online} className={styles.historyRefresh} onClick={() => void runAction(refresh)}>
            Refresh
          </button>
        </div>
        {approvals.length === 0 ? (
          <p className={styles.hint}>No approved allocations yet.</p>
        ) : (
          <div className={styles.historyList}>
            {approvals.map((approval) => (
              <article key={approval.approval_id} className={styles.historyEntry}>
                <div className={styles.historyTop}>
                  <strong>Approved allocation</strong>
                  <span className={styles.historyStatus}>Approved</span>
                </div>
                <small>{new Date(approval.approved_at).toLocaleString()}</small>
                <div className={styles.historyTotals}>
                  {RESOURCES.map((resource) => (
                    <span key={resource}>{resource}: <strong>{approval.resources[resource].optimized.allocated}</strong></span>
                  ))}
                </div>
                <p className={styles.historyId}>Approval ID: {approval.approval_id}</p>
                <div className={styles.receiptHistoryRow}>
                  <span>
                    {receiptMetadata[approval.approval_id]
                      ? `${receiptMetadata[approval.approval_id].receipt_count} receipt(s) issued`
                      : "Receipt status unavailable"}
                  </span>
                  {receiptMetadata[approval.approval_id]?.receipt_count ? (
                    <button type="button" className={styles.historyRefresh} disabled={busy}
                      onClick={() => viewReceiptStatus(approval.approval_id)}>
                      {viewReceiptApprovalId === approval.approval_id ? "Hide receipt status" : "View receipt status"}
                    </button>
                  ) : (
                    <button type="button" className={styles.issueReceiptButton}
                      disabled={busy || !online || !receiptMetadata[approval.approval_id] ||
                        RESOURCES.every((resource) => approval.resources[resource].optimized.allocated === 0)}
                      onClick={() => issueReceipts(approval.approval_id)}>
                      {receiptBusyId === approval.approval_id ? "Issuing..." : "Issue QR receipts"}
                    </button>
                  )}
                </div>
                {viewReceiptApprovalId === approval.approval_id && (
                  <div className={styles.receiptStatusList}>
                    <p className={styles.hint}>Receipt metadata only — secret tokens are never retrieved.</p>
                    {(receiptMetadata[approval.approval_id]?.receipts ?? []).map((receipt) => (
                      <div key={receipt.receipt_id} className={styles.receiptStatusRow}>
                        <div>
                          <strong>{receipt.household_id ?? receipt.message_id.slice(0, 8)} · {receipt.resource ?? "Resource"} · {receipt.quantity ?? "?"} units</strong>
                          <p>Status: <strong>{receipt.status}</strong> · Issued: {new Date(receipt.issued_at).toLocaleString()}</p>
                          {receipt.collected_at && <p>Collected: {new Date(receipt.collected_at).toLocaleString()}</p>}
                          <small>Receipt ID: {receipt.receipt_id}</small>
                          <small>Allocation ID: {receipt.allocation_id}</small>
                        </div>
                        {receipt.status === "issued" && !receipt.collected_at && (
                          <button type="button" className={styles.historyRefresh} disabled={busy}
                            onClick={() => { setReissueReceiptId(receipt.receipt_id); setReissueReason(""); }}>
                            Reissue lost QR
                          </button>
                        )}
                        {reissueReceiptId === receipt.receipt_id && (
                          <div className={styles.reissuePanel}>
                            <label htmlFor={`reason-${receipt.receipt_id}`}>Reason for reissue (audit logged)</label>
                            <input id={`reason-${receipt.receipt_id}`} value={reissueReason}
                              maxLength={300} placeholder="Lost receipt verified with household"
                              onChange={(event) => setReissueReason(event.target.value)} />
                            <button type="button" className={styles.issueReceiptButton} disabled={busy || reissueReason.trim().length < 8}
                              onClick={() => reissueReceipt(receipt.receipt_id, approval.approval_id)}>Confirm reissue</button>
                            <button type="button" className={styles.historyRefresh} onClick={() => setReissueReceiptId(null)}>Cancel</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {receiptApprovalId && issuedReceipts.length > 0 && (
        <section className={styles.panel} aria-label="Newly issued QR receipts">
          <div className={styles.panelHeader}>
            <div>
              <h2>Newly Issued QR Receipts</h2>
              <p>Print or securely save these {issuedReceipts.length} receipts now. Raw tokens are shown only once.</p>
            </div>
            <button type="button" className={styles.historyRefresh} onClick={closeReceiptPanel}>Close receipts</button>
          </div>
          <p className={styles.receiptSecurityNotice}>
            Each QR code is a bearer credential. Give each receipt only to its intended household.
            Do not screenshot or publish the full receipt collection.
          </p>
          <div className={styles.receiptGrid}>
            {issuedReceipts.map((receipt) => (
              <AllocationReceiptQR key={receipt.receipt_id} receipt={receipt} />
            ))}
          </div>
        </section>
      )}

      {/* Operation Feedback */}
      {feedback && (
        <p
          role="status"
          className={styles.feedback}
        >
          {feedback}
        </p>
      )}

      {/* Footer */}
      <footer className={styles.footer}>
        AFTERGRID · Offline-first crisis coordination
        · Human oversight required
      </footer>
    </main>
  );
}
