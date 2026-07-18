import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret } from "../src/auth/encryption.js";

describe("encryption", () => {
  it("round-trips a secret through encrypt/decrypt", () => {
    const plaintext = "mx0vgl-super-secret-api-key";
    const encrypted = encryptSecret(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const plaintext = "same-secret";
    expect(encryptSecret(plaintext)).not.toBe(encryptSecret(plaintext));
  });

  it("throws on a tampered ciphertext", () => {
    const encrypted = encryptSecret("some-secret");
    const [iv, tag, ciphertext] = encrypted.split(":");
    const tampered = `${iv}:${tag}:${ciphertext.slice(0, -2)}00`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("throws on malformed input", () => {
    expect(() => decryptSecret("not-a-valid-payload")).toThrow();
  });
});
