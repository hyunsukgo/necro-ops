import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import * as schema from "./schema.js";

type DbInstance = ReturnType<typeof drizzle<typeof schema>>;

let _db: DbInstance | null = null;
let _sqlite: InstanceType<typeof Database> | null = null;

function resolveDbPath(): string {
  const url = process.env["DATABASE_URL"] ?? "./necro-ops.db";
  return path.isAbsolute(url) ? url : path.resolve(process.cwd(), url);
}

export function getDb(): DbInstance {
  if (!_db) {
    const dbPath = resolveDbPath();
    const sqlite = new Database(dbPath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    _sqlite = sqlite;
    _db = drizzle(sqlite, { schema });
  }
  return _db;
}

/** Exposed for testing — closes the connection and resets the cached instance. */
export function _resetDb(): void {
  try {
    _sqlite?.close();
  } catch {
    // ignore errors on close (e.g. already closed)
  }
  _db = null;
  _sqlite = null;
}
