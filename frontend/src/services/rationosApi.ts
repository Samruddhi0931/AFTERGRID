import type { ResourceRequest } from "../schemas/message";

const API_BASE = "http://127.0.0.1:8000";

export type Resource = "food" | "water" | "medicine";
export type DraftStatus = "pending" | "approved" | "rejected";

export interface InventoryItem {
  resource: Resource;
  available: number;
}

export interface AllocationItem {
  allocation_id?: string;
  message_id: string;
  household_id: string;
  requested: number;
  allocated: number;
  fulfillment_percent: number;
  level?: number;
  resource?: Resource;
  urgency?: string;
  unmet?: number;
}

export interface AllocationSummary {
  allocations: AllocationItem[];
  available: number;
  allocated: number;
  remaining: number;
  fairness_score: number;
  fulfillment_rate: number;
}

export type AllocationResources = Record<
  Resource,
  { optimized: AllocationSummary; baseline: AllocationSummary }
>;

export interface AllocationResult {
  draft_id: string;
  status: DraftStatus;
  requires_human_approval: boolean;
  policy: string;
  resources: AllocationResources;
  created_at: string;
  decided_at: string | null;
  approval_id: string | null;
}

export interface ApprovalRecord {
  approval_id: string;
  draft_id: string;
  approved_at: string;
  status: "approved";
  resources: AllocationResources;
}

export interface ServerRequest {
  message_id: string;
  household_id: string;
  level: number;
  resource: Resource;
  quantity: number;
  urgency: string;
  created_at: string;
  received_at: string;
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
  } catch {
    throw new Error("RationOS backend is unreachable. Start FastAPI and retry.");
  }

  if (!response.ok) {
    if (response.status === 409 && path === "/requests") {
      throw new Error("Request already synchronized.");
    }
    let detail = `RationOS API error: HTTP ${response.status}`;
    try {
      const body: unknown = await response.json();
      if (typeof body === "object" && body !== null && "detail" in body) {
        const message = (body as { detail: unknown }).detail;
        if (typeof message === "string") detail = message;
      }
    } catch {
      // Preserve HTTP status if the error body is not JSON.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export function fetchInventory() {
  return api<InventoryItem[]>("/inventory");
}

export function updateInventory(resource: Resource, available: number) {
  return api<InventoryItem>("/inventory", {
    method: "PUT",
    body: JSON.stringify({ resource, available }),
  });
}

export function fetchServerRequests() {
  return api<ServerRequest[]>("/requests");
}

export function syncRequest(request: ResourceRequest) {
  return api<ServerRequest>("/requests", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function calculateAllocation() {
  return api<AllocationResult>("/allocate", { method: "POST" });
}

export function fetchDrafts() {
  return api<AllocationResult[]>("/drafts");
}

export function approveDraft(draftId: string) {
  return api<ApprovalRecord>(`/drafts/${encodeURIComponent(draftId)}/approve`, {
    method: "POST",
  });
}

export function rejectDraft(draftId: string) {
  return api<AllocationResult>(`/drafts/${encodeURIComponent(draftId)}/reject`, {
    method: "POST",
  });
}

export function fetchApprovals() {
  return api<ApprovalRecord[]>("/approvals");
}

// Step 12.3B — one-time allocation receipts
export interface IssuedReceipt {
  receipt_id: string;
  allocation_id: string;
  message_id: string;
  household_id: string;
  resource: Resource;
  quantity: number;
  status: "issued";
  token: string;
}

export interface ReceiptIssuanceResult {
  approval_id: string;
  status: "issued";
  receipt_count: number;
  receipts: IssuedReceipt[];
}

export interface ReceiptMetadata {
  receipt_id: string;
  allocation_id: string;
  message_id: string;
  status: string;
  issued_at: string;
  collected_at: string | null;
  household_id?: string | null;
  resource?: Resource | null;
  quantity?: number | null;
}

export interface ReceiptListResult {
  approval_id: string;
  receipt_count: number;
  receipts: ReceiptMetadata[];
}

export function issueAllocationReceipts(approvalId: string) {
  return api<ReceiptIssuanceResult>(
    `/approvals/${encodeURIComponent(approvalId)}/receipts`,
    { method: "POST" }
  );
}

export function fetchAllocationReceipts(approvalId: string) {
  return api<ReceiptListResult>(
    `/approvals/${encodeURIComponent(approvalId)}/receipts`
  );
}


export function reissueAllocationReceipt(receiptId: string, reason: string) {
  return api<{ approval_id: string; receipt: IssuedReceipt }>(
    `/receipts/${encodeURIComponent(receiptId)}/reissue`,
    { method: "POST", body: JSON.stringify({ reason }) }
  );
}


// Step 12.4 — Verify first, then explicitly confirm collection.
export interface CollectionDetails {
  receipt_id: string;
  allocation_id: string;
  approval_id: string;
  message_id: string;
  household_id: string;
  resource: Resource;
  quantity: number;
  status: "issued" | "collected";
  collected_at: string | null;
}

export function verifyCollectionToken(token: string) {
  return api<CollectionDetails>("/receipts/verify", {
    method: "POST", body: JSON.stringify({ token }),
  });
}

export function collectReceipt(token: string) {
  return api<CollectionDetails>("/receipts/collect", {
    method: "POST", body: JSON.stringify({ token }),
  });
}
