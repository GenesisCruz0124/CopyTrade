import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/passwords.js";

describe("passwords", () => {
  it("verifies a correct password against its hash", () => {
    const hash = hashPassword("correct-horse-battery-staple");
    expect(verifyPassword("correct-horse-battery-staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", () => {
    const hash = hashPassword("correct-horse-battery-staple");
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("produces a different hash each time (random salt)", () => {
    expect(hashPassword("same-password")).not.toBe(hashPassword("same-password"));
  });

  it("rejects malformed stored hashes", () => {
    expect(verifyPassword("anything", "not-a-valid-hash")).toBe(false);
  });
});
