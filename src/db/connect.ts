import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { ensureDir } from "../config.js";
import * as schema from "./schema.js";

export type DB = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const here = path.dirname(fileURLToPath(import.meta.url));
// Migrations live in <repo>/drizzle. Same relative path from src/ at dev time
// and dist/ at runtime.
const MIGRATIONS_FOLDER = path.resolve(here, "..", "..", "drizzle");

export function openDb(dbPath: string): DB {
  ensureDir(dbPath);
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db as DB;
}
