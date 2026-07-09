import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../config/env.js";
import { runMigrations } from "./migrations.js";
import { logger } from "../logger.js";

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  mkdirSync(dirname(env.DB_PATH), { recursive: true });
  const db = new Database(env.DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  logger.info({ dbPath: env.DB_PATH }, "database ready");
  dbInstance = db;
  return db;
}
