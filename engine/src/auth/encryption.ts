import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/** Derives a 32-byte key from the configured secret so any string length is accepted. */
function deriveKey(): Buffer {
  if (!env.CREDENTIALS_ENCRYPTION_KEY) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY must be set to store exchange API credentials. Set it in .env to a long random string."
    );
  }
  return createHash("sha256").update(env.CREDENTIALS_ENCRYPTION_KEY).digest();
}

/** Encrypts to `iv:authTag:ciphertext`, all hex-encoded, for storage in a TEXT column. */
export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decryptSecret(stored: string): string {
  const key = deriveKey();
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted credential");
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, "hex")), decipher.final()]);
  return plaintext.toString("utf8");
}
