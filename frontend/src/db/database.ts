import Dexie, { type Table } from "dexie";

import {
  ResourceRequestSchema,
  type ResourceRequest,
} from "../schemas/message";

// A locally stored emergency request
export interface StoredRequest {
  id: string;
  request: ResourceRequest;
  status: "pending" | "shared" | "received";
  createdAt: string;
}

// HAVEN's local browser database
class HavenDatabase extends Dexie {
  requests!: Table<StoredRequest, string>;

  constructor() {
    super("HAVEN_DB");

    this.version(1).stores({
      requests: "id, status, createdAt",
    });
  }
}

export const db = new HavenDatabase();

// Save a validated emergency request
export async function saveRequest(
  input: unknown
): Promise<StoredRequest> {
  const request = ResourceRequestSchema.parse(input);

  const storedRequest: StoredRequest = {
    id: request.messageId,
    request,
    status: "pending",
    createdAt: request.createdAt,
  };

  // add() rejects duplicate primary keys
  await db.requests.add(storedRequest);

  return storedRequest;
}

// Retrieve all saved requests, newest first
export async function getRequests():
  Promise<StoredRequest[]> {
  return db.requests
    .orderBy("createdAt")
    .reverse()
    .toArray();
}

// Retrieve one request by its unique ID
export async function getRequestById(
  id: string
): Promise<StoredRequest | undefined> {
  return db.requests.get(id);
}

// Mark a request as shared
export async function markRequestShared(
  id: string
): Promise<void> {
  const updated = await db.requests.update(
    id,
    { status: "shared" }
  );

  if (updated === 0) {
    throw new Error("Request not found");
  }
}