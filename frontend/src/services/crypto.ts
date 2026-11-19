import { z } from "zod";

import {
  ResourceRequestSchema,
  type ResourceRequest,
} from "../schemas/message";

// --------------------------------------------------
// 1. Encrypted Message Schema
// --------------------------------------------------

export const EncryptedEnvelopeSchema = z
  .object({
    version: z.literal(1),
    messageId: z.uuid(),
    algorithm: z.literal("AES-256-GCM"),
    iv: z.string().min(1).max(32),
    ciphertext: z.string().min(1).max(8192),
  })
  .strict();

export type EncryptedEnvelope = z.infer<
  typeof EncryptedEnvelopeSchema
>;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

// --------------------------------------------------
// 2. Base64URL Encoding
// --------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Return an ArrayBuffer-backed Uint8Array.
// This fixes newer TypeScript BufferSource errors.
function fromBase64Url(
  value: string
): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid Base64URL encoding");
  }

  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const padded = normalized.padEnd(
    Math.ceil(normalized.length / 4) * 4,
    "="
  );

  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

// --------------------------------------------------
// 3. Authenticated Metadata
// --------------------------------------------------

function authenticatedMetadata(
  messageId: string
): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    JSON.stringify({
      version: 1,
      messageId,
      algorithm: "AES-256-GCM",
    })
  );
}

// --------------------------------------------------
// 4. Generate Demo Encryption Key
// --------------------------------------------------

export async function generateDemoKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );
}

// --------------------------------------------------
// 5. Encrypt Emergency Request
// --------------------------------------------------

export async function encryptMessage(
  input: ResourceRequest,
  key: CryptoKey
): Promise<EncryptedEnvelope> {
  const message = ResourceRequestSchema.parse(input);

  // Generate a fresh 96-bit IV for each encryption.
  const iv = crypto.getRandomValues(
    new Uint8Array(12)
  );

  const plaintext = encoder.encode(
    JSON.stringify(message)
  );

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: authenticatedMetadata(
        message.messageId
      ),
      tagLength: 128,
    },
    key,
    plaintext
  );

  return {
    version: 1,
    messageId: message.messageId,
    algorithm: "AES-256-GCM",
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(
      new Uint8Array(ciphertext)
    ),
  };
}

// --------------------------------------------------
// 6. Decrypt Emergency Request
// --------------------------------------------------

export async function decryptMessage(
  input: unknown,
  key: CryptoKey
): Promise<ResourceRequest> {
  const envelope = EncryptedEnvelopeSchema.parse(input);

  const iv = fromBase64Url(envelope.iv);

  if (iv.length !== 12) {
    throw new Error("Invalid AES-GCM IV length");
  }

  const ciphertext = fromBase64Url(
    envelope.ciphertext
  );

  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: authenticatedMetadata(
        envelope.messageId
      ),
      tagLength: 128,
    },
    key,
    ciphertext
  );

  const parsed: unknown = JSON.parse(
    decoder.decode(plaintext)
  );

  const message = ResourceRequestSchema.parse(parsed);

  if (message.messageId !== envelope.messageId) {
    throw new Error("Message ID mismatch");
  }

  return message;
}

// --------------------------------------------------
// 7. Serialize Encrypted Envelope
// --------------------------------------------------

export function serializeEnvelope(
  envelope: EncryptedEnvelope
): string {
  return JSON.stringify(
    EncryptedEnvelopeSchema.parse(envelope)
  );
}

// --------------------------------------------------
// 8. Parse Encrypted Envelope
// --------------------------------------------------

export function parseEnvelope(
  raw: string
): EncryptedEnvelope {
  if (raw.length > 12000) {
    throw new Error("Encrypted message is too large");
  }

  const parsed: unknown = JSON.parse(raw);

  return EncryptedEnvelopeSchema.parse(parsed);
}