const KEY_BYTES = 32;

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

function fromBase64Url(
  value: string
): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid key format");
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

export function generateSharedKey(): string {
  const bytes = crypto.getRandomValues(
    new Uint8Array(KEY_BYTES)
  );

  return toBase64Url(bytes);
}

export async function importSharedKey(
  encodedKey: string
): Promise<CryptoKey> {
  const bytes = fromBase64Url(encodedKey.trim());

  if (bytes.length !== KEY_BYTES) {
    throw new Error(
      "Shared key must contain exactly 32 bytes"
    );
  }

  return crypto.subtle.importKey(
    "raw",
    bytes,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"]
  );
}