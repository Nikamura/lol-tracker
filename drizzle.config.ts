import "dotenv/config";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Config } from "drizzle-kit";

const dbUrl = process.env.LOL_TRACKER_DB ?? "./data/lol-tracker.db";
// drizzle-kit opens the DB directly, bypassing openDb()'s ensureDir. Make
// sure the parent directory exists so push/migrate/studio don't trip on a
// fresh checkout or right after db:reset.
mkdirSync(path.dirname(dbUrl), { recursive: true });

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url: dbUrl },
  verbose: true,
} satisfies Config;
