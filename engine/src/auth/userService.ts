import { randomBytes, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { decryptSecret, encryptSecret } from "./encryption.js";
import { hashPassword, verifyPassword } from "./passwords.js";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  api_token: string;
  role: "user" | "admin";
  trading_mode: "paper" | "live";
  futures_trading_mode: "paper" | "live";
  futures_paper_seed_balance_usdt: number;
  mexc_api_key_encrypted: string | null;
  mexc_api_secret_encrypted: string | null;
  mexc_futures_access_key_encrypted: string | null;
  mexc_futures_secret_key_encrypted: string | null;
  created_at: number;
  updated_at: number;
}

export interface PublicUser {
  id: string;
  email: string;
  apiToken: string;
  role: "user" | "admin";
  tradingMode: "paper" | "live";
  futuresTradingMode: "paper" | "live";
  futuresPaperSeedBalanceUsdt: number;
  hasSpotKeys: boolean;
  hasFuturesKeys: boolean;
  createdAt: number;
}

export interface DecryptedExchangeKeys {
  mexcApiKey: string | null;
  mexcApiSecret: string | null;
  mexcFuturesAccessKey: string | null;
  mexcFuturesSecretKey: string | null;
}

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super("An account with this email already exists");
    this.name = "EmailAlreadyRegisteredError";
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password");
    this.name = "InvalidCredentialsError";
  }
}

function generateApiToken(): string {
  return randomBytes(32).toString("hex");
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    apiToken: row.api_token,
    role: row.role,
    tradingMode: row.trading_mode,
    futuresTradingMode: row.futures_trading_mode,
    futuresPaperSeedBalanceUsdt: row.futures_paper_seed_balance_usdt,
    hasSpotKeys: !!row.mexc_api_key_encrypted && !!row.mexc_api_secret_encrypted,
    hasFuturesKeys: !!row.mexc_futures_access_key_encrypted && !!row.mexc_futures_secret_key_encrypted,
    createdAt: row.created_at
  };
}

export function registerUser(db: Database.Database, email: string, password: string): UserRow {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
  if (existing) {
    throw new EmailAlreadyRegisteredError();
  }
  const now = Date.now();
  const row: UserRow = {
    id: randomUUID(),
    email: normalizedEmail,
    password_hash: hashPassword(password),
    api_token: generateApiToken(),
    role: "user",
    trading_mode: "paper",
    futures_trading_mode: "paper",
    futures_paper_seed_balance_usdt: 50000,
    mexc_api_key_encrypted: null,
    mexc_api_secret_encrypted: null,
    mexc_futures_access_key_encrypted: null,
    mexc_futures_secret_key_encrypted: null,
    created_at: now,
    updated_at: now
  };
  db.prepare(
    `INSERT INTO users (id, email, password_hash, api_token, role, trading_mode, futures_trading_mode,
      futures_paper_seed_balance_usdt, created_at, updated_at)
     VALUES (@id, @email, @password_hash, @api_token, @role, @trading_mode, @futures_trading_mode,
      @futures_paper_seed_balance_usdt, @created_at, @updated_at)`
  ).run(row);
  return row;
}

export function authenticateUser(db: Database.Database, email: string, password: string): UserRow {
  const normalizedEmail = email.trim().toLowerCase();
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizedEmail) as UserRow | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new InvalidCredentialsError();
  }
  return row;
}

export function getUserByApiToken(db: Database.Database, token: string): UserRow | null {
  const row = db.prepare("SELECT * FROM users WHERE api_token = ?").get(token) as UserRow | undefined;
  return row ?? null;
}

export function getUserById(db: Database.Database, id: string): UserRow | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ?? null;
}

export function updateExchangeKeys(
  db: Database.Database,
  userId: string,
  keys: {
    mexcApiKey?: string | null;
    mexcApiSecret?: string | null;
    mexcFuturesAccessKey?: string | null;
    mexcFuturesSecretKey?: string | null;
  }
): UserRow {
  const current = getUserById(db, userId);
  if (!current) {
    throw new Error("User not found");
  }
  const next = {
    mexc_api_key_encrypted:
      keys.mexcApiKey !== undefined
        ? keys.mexcApiKey === null || keys.mexcApiKey === ""
          ? null
          : encryptSecret(keys.mexcApiKey)
        : current.mexc_api_key_encrypted,
    mexc_api_secret_encrypted:
      keys.mexcApiSecret !== undefined
        ? keys.mexcApiSecret === null || keys.mexcApiSecret === ""
          ? null
          : encryptSecret(keys.mexcApiSecret)
        : current.mexc_api_secret_encrypted,
    mexc_futures_access_key_encrypted:
      keys.mexcFuturesAccessKey !== undefined
        ? keys.mexcFuturesAccessKey === null || keys.mexcFuturesAccessKey === ""
          ? null
          : encryptSecret(keys.mexcFuturesAccessKey)
        : current.mexc_futures_access_key_encrypted,
    mexc_futures_secret_key_encrypted:
      keys.mexcFuturesSecretKey !== undefined
        ? keys.mexcFuturesSecretKey === null || keys.mexcFuturesSecretKey === ""
          ? null
          : encryptSecret(keys.mexcFuturesSecretKey)
        : current.mexc_futures_secret_key_encrypted
  };
  db.prepare(
    `UPDATE users SET mexc_api_key_encrypted = @mexc_api_key_encrypted,
      mexc_api_secret_encrypted = @mexc_api_secret_encrypted,
      mexc_futures_access_key_encrypted = @mexc_futures_access_key_encrypted,
      mexc_futures_secret_key_encrypted = @mexc_futures_secret_key_encrypted,
      updated_at = @updated_at
     WHERE id = @id`
  ).run({ ...next, updated_at: Date.now(), id: userId });
  return getUserById(db, userId)!;
}

export function updateTradingMode(
  db: Database.Database,
  userId: string,
  mode: { tradingMode?: "paper" | "live"; futuresTradingMode?: "paper" | "live" }
): UserRow {
  const current = getUserById(db, userId);
  if (!current) {
    throw new Error("User not found");
  }
  const tradingMode = mode.tradingMode ?? current.trading_mode;
  const futuresTradingMode = mode.futuresTradingMode ?? current.futures_trading_mode;
  db.prepare(
    `UPDATE users SET trading_mode = @trading_mode, futures_trading_mode = @futures_trading_mode, updated_at = @updated_at
     WHERE id = @id`
  ).run({
    trading_mode: tradingMode,
    futures_trading_mode: futuresTradingMode,
    updated_at: Date.now(),
    id: userId
  });
  return getUserById(db, userId)!;
}

export function decryptExchangeKeys(row: UserRow): DecryptedExchangeKeys {
  return {
    mexcApiKey: row.mexc_api_key_encrypted ? decryptSecret(row.mexc_api_key_encrypted) : null,
    mexcApiSecret: row.mexc_api_secret_encrypted ? decryptSecret(row.mexc_api_secret_encrypted) : null,
    mexcFuturesAccessKey: row.mexc_futures_access_key_encrypted
      ? decryptSecret(row.mexc_futures_access_key_encrypted)
      : null,
    mexcFuturesSecretKey: row.mexc_futures_secret_key_encrypted
      ? decryptSecret(row.mexc_futures_secret_key_encrypted)
      : null
  };
}
