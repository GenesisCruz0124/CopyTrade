import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/db/migrations.js";
import {
  registerUser,
  authenticateUser,
  getUserByApiToken,
  getUserById,
  updateExchangeKeys,
  updateTradingMode,
  decryptExchangeKeys,
  toPublicUser,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError
} from "../src/auth/userService.js";

describe("userService", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
  });

  it("registers a new user with a unique api token and defaults", () => {
    const user = registerUser(db, "Trader@Example.com", "password123");
    expect(user.email).toBe("trader@example.com");
    expect(user.api_token).toHaveLength(64);
    expect(user.role).toBe("user");
    expect(user.trading_mode).toBe("paper");
    expect(user.futures_trading_mode).toBe("paper");
  });

  it("rejects registering the same email twice", () => {
    registerUser(db, "dupe@example.com", "password123");
    expect(() => registerUser(db, "dupe@example.com", "password123")).toThrow(EmailAlreadyRegisteredError);
  });

  it("authenticates with correct credentials and rejects incorrect ones", () => {
    registerUser(db, "login@example.com", "correct-password");
    const user = authenticateUser(db, "login@example.com", "correct-password");
    expect(user.email).toBe("login@example.com");
    expect(() => authenticateUser(db, "login@example.com", "wrong-password")).toThrow(InvalidCredentialsError);
    expect(() => authenticateUser(db, "nobody@example.com", "whatever")).toThrow(InvalidCredentialsError);
  });

  it("looks up a user by api token", () => {
    const created = registerUser(db, "token@example.com", "password123");
    const found = getUserByApiToken(db, created.api_token);
    expect(found?.id).toBe(created.id);
    expect(getUserByApiToken(db, "bogus-token")).toBeNull();
  });

  it("stores exchange keys encrypted and round-trips them via decryptExchangeKeys", () => {
    const created = registerUser(db, "keys@example.com", "password123");
    const updated = updateExchangeKeys(db, created.id, {
      mexcApiKey: "spot-key",
      mexcApiSecret: "spot-secret",
      mexcFuturesAccessKey: "futures-key",
      mexcFuturesSecretKey: "futures-secret"
    });
    expect(updated.mexc_api_key_encrypted).not.toBe("spot-key");
    const decrypted = decryptExchangeKeys(updated);
    expect(decrypted).toEqual({
      mexcApiKey: "spot-key",
      mexcApiSecret: "spot-secret",
      mexcFuturesAccessKey: "futures-key",
      mexcFuturesSecretKey: "futures-secret"
    });
    expect(toPublicUser(updated).hasSpotKeys).toBe(true);
    expect(toPublicUser(updated).hasFuturesKeys).toBe(true);
  });

  it("clears an exchange key when set to null", () => {
    const created = registerUser(db, "clear@example.com", "password123");
    updateExchangeKeys(db, created.id, { mexcApiKey: "spot-key", mexcApiSecret: "spot-secret" });
    const cleared = updateExchangeKeys(db, created.id, { mexcApiKey: null, mexcApiSecret: null });
    expect(cleared.mexc_api_key_encrypted).toBeNull();
    expect(toPublicUser(cleared).hasSpotKeys).toBe(false);
  });

  it("leaves unspecified exchange keys untouched", () => {
    const created = registerUser(db, "partial@example.com", "password123");
    updateExchangeKeys(db, created.id, { mexcApiKey: "spot-key", mexcApiSecret: "spot-secret" });
    const updated = updateExchangeKeys(db, created.id, { mexcFuturesAccessKey: "futures-key" });
    const decrypted = decryptExchangeKeys(updated);
    expect(decrypted.mexcApiKey).toBe("spot-key");
    expect(decrypted.mexcFuturesAccessKey).toBe("futures-key");
  });

  it("updates trading mode independently for spot and futures", () => {
    const created = registerUser(db, "mode@example.com", "password123");
    const updated = updateTradingMode(db, created.id, { tradingMode: "live" });
    expect(updated.trading_mode).toBe("live");
    expect(updated.futures_trading_mode).toBe("paper");

    const updated2 = updateTradingMode(db, created.id, { futuresTradingMode: "live" });
    expect(updated2.trading_mode).toBe("live");
    expect(updated2.futures_trading_mode).toBe("live");
  });

  it("getUserById returns null for an unknown id", () => {
    expect(getUserById(db, "nonexistent")).toBeNull();
  });
});
