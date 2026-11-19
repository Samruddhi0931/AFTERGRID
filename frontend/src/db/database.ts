import Dexie, { type Table } from "dexie";

import {
  ResourceRequestSchema,
  type ResourceRequest,
} from "../schemas/message";

// --------------------------------------------------
// 1. Resident Request Storage
// --------------------------------------------------

export interface StoredRequest {
  id: string;
  request: ResourceRequest;
  status: "pending" | "shared" | "received";
  createdAt: string;
}

// --------------------------------------------------
// 2. GhostLine Coordinator Inbox Storage
// --------------------------------------------------

export interface InboxMessage {
  id: string;
  request: ResourceRequest;
  receivedAt: string;
  source: "ghostline";
}

// --------------------------------------------------
// 3. HAVEN IndexedDB
// --------------------------------------------------

class HavenDatabase extends Dexie {
  requests!: Table<StoredRequest, string>;
  inbox!: Table<InboxMessage, string>;

  constructor() {
    super("HAVEN_DB");

    // Original resident request storage.
    this.version(1).stores({
      requests: "id, status, createdAt",
    });

    // GhostLine coordinator inbox.
    this.version(2).stores({
      requests: "id, status, createdAt",
      inbox: "id, receivedAt, source",
    });
  }
}

export const db = new HavenDatabase();

// --------------------------------------------------
// 4. Save Resident Emergency Request
// --------------------------------------------------

export async function saveRequest(
  input: unknown
): Promise<StoredRequest> {
  const request = ResourceRequestSchema.parse(input);

  const stored: StoredRequest = {
    id: request.messageId,
    request,
    status: "pending",
    createdAt: request.createdAt,
  };

  await db.requests.add(stored);

  return stored;
}

// --------------------------------------------------
// 5. Read Resident Requests
// --------------------------------------------------

export async function getRequests(): Promise<StoredRequest[]> {
  return db.requests
    .orderBy("createdAt")
    .reverse()
    .toArray();
}

// --------------------------------------------------
// 6. Read a Specific Request
// --------------------------------------------------

export async function getRequestById(
  id: string
): Promise<StoredRequest | undefined> {
  return db.requests.get(id);
}

// --------------------------------------------------
// 7. Mark Request as Shared
// --------------------------------------------------

export async function markRequestShared(
  id: string
): Promise<void> {
  await db.requests.update(id, {
    status: "shared",
  });
}

// --------------------------------------------------
// 8. Import a Decrypted GhostLine Message
// --------------------------------------------------

export async function importInboxMessage(
  input: unknown
): Promise<InboxMessage> {
  const request = ResourceRequestSchema.parse(input);

  const message: InboxMessage = {
    id: request.messageId,
    request,
    receivedAt: new Date().toISOString(),
    source: "ghostline",
  };

  try {
    // add() rejects duplicate primary keys.
    await db.inbox.add(message);
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "ConstraintError"
    ) {
      throw new Error(
        "Duplicate request: this message was already imported.",
        { cause: error }
      );
    }

    throw error;
  }

  return message;
}

// --------------------------------------------------
// 9. Read GhostLine Coordinator Inbox
// --------------------------------------------------

export async function getInboxMessages(): Promise<InboxMessage[]> {
  return db.inbox
    .orderBy("receivedAt")
    .reverse()
    .toArray();
}

// --------------------------------------------------
// 10. Read a Specific Inbox Message
// --------------------------------------------------

export async function getInboxMessageById(
  id: string
): Promise<InboxMessage | undefined> {
  return db.inbox.get(id);
}
