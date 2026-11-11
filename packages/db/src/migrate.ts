// Run all pending migrations against the connected database.
// Invoked by the dev server startup and the seed script.

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, "../drizzle");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function runMigrations(db: BetterSQLite3Database<any>): void {
  migrate(db, { migrationsFolder });
}
