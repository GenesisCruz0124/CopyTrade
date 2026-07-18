import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/db/migrations.js";
import { UserFuturesRuntimeRegistry } from "../src/runtime/userFuturesRuntime.js";
import { registerUser, updateExchangeKeys, updateTradingMode, type UserRow } from "../src/auth/userService.js";
import type { FuturesRestClient } from "../src/mexcFutures/futuresRestClient.js";
import type { SafetyRails } from "../src/safety/safetyRails.js";

const fakePublicFuturesClient = {
  contractDetail: async () => {
    throw new Error("not used by these tests");
  },
  ticker: async () => {
    throw new Error("not used by these tests");
  }
} as unknown as FuturesRestClient;

const fakeSafety = { isKillSwitchEngaged: () => false } as unknown as SafetyRails;

describe("UserFuturesRuntimeRegistry", () => {
  let db: Database.Database;
  let registry: UserFuturesRuntimeRegistry;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    registry = new UserFuturesRuntimeRegistry({
      mainDb: db,
      safety: fakeSafety,
      publicFuturesClient: fakePublicFuturesClient,
      maxFuturesLeverage: 20
    });
  });

  it("defaults a fresh user to an isolated paper runtime", () => {
    const user = registerUser(db, "paper@example.com", "password123");
    const runtime = registry.getOrCreate(user);
    expect(runtime.mode).toBe("paper");
  });

  it("caches and returns the same runtime instance on repeated calls", () => {
    const user = registerUser(db, "cache@example.com", "password123");
    const first = registry.getOrCreate(user);
    const second = registry.getOrCreate(user);
    expect(second).toBe(first);
  });

  it("rebuilds the runtime when trading mode changes", () => {
    const user = registerUser(db, "mode@example.com", "password123");
    const paperRuntime = registry.getOrCreate(user);

    const withKeys = updateExchangeKeys(db, user.id, {
      mexcFuturesAccessKey: "access",
      mexcFuturesSecretKey: "secret"
    });
    const liveUser = updateTradingMode(db, withKeys.id, { futuresTradingMode: "live" });

    const liveRuntime = registry.getOrCreate(liveUser);
    expect(liveRuntime).not.toBe(paperRuntime);
    expect(liveRuntime.mode).toBe("live");
  });

  it("throws a clear error switching to live without futures keys saved", () => {
    const user = registerUser(db, "nokeys@example.com", "password123");
    const liveUser = updateTradingMode(db, user.id, { futuresTradingMode: "live" });
    expect(() => registry.getOrCreate(liveUser)).toThrow(/Set your MEXC futures API keys/);
  });

  it("gives two different users independent paper runtimes", () => {
    const userA = registerUser(db, "a@example.com", "password123");
    const userB = registerUser(db, "b@example.com", "password123");
    const runtimeA = registry.getOrCreate(userA);
    const runtimeB = registry.getOrCreate(userB);
    expect(runtimeA).not.toBe(runtimeB);
    expect(runtimeA.positions).not.toBe(runtimeB.positions);
  });

  describe("background loop", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("evicts idle runtimes so a later access rebuilds", () => {
      const shortLivedRegistry = new UserFuturesRuntimeRegistry({
        mainDb: db,
        safety: fakeSafety,
        publicFuturesClient: fakePublicFuturesClient,
        maxFuturesLeverage: 20,
        idleEvictionMs: 1000
      });
      const user = registerUser(db, "idle@example.com", "password123");
      const first = shortLivedRegistry.getOrCreate(user);

      const timer = shortLivedRegistry.startBackgroundLoop(500);
      vi.advanceTimersByTime(1500);
      clearInterval(timer);

      const second = shortLivedRegistry.getOrCreate(user);
      expect(second).not.toBe(first);
    });

    it("keeps a recently-accessed runtime alive across sweeps", () => {
      const shortLivedRegistry = new UserFuturesRuntimeRegistry({
        mainDb: db,
        safety: fakeSafety,
        publicFuturesClient: fakePublicFuturesClient,
        maxFuturesLeverage: 20,
        idleEvictionMs: 5000
      });
      const user = registerUser(db, "active@example.com", "password123");
      const first = shortLivedRegistry.getOrCreate(user);

      const timer = shortLivedRegistry.startBackgroundLoop(1000);
      vi.advanceTimersByTime(3000);
      shortLivedRegistry.getOrCreate(user); // touch it so it doesn't look idle
      vi.advanceTimersByTime(3000);
      clearInterval(timer);

      const second = shortLivedRegistry.getOrCreate(user);
      expect(second).toBe(first);
    });
  });
});
