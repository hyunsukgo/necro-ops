/**
 * lib/db.ts — ensures migrations run once per process before any DB query,
 * then returns the singleton client.
 *
 * Import `ensureDb` from this file everywhere in the Next.js app instead of
 * importing directly from @necro-ops/db, so the schema is always up to date.
 */

import { getDb, runMigrations, seedDemoScenarios } from "@necro-ops/db";

type DbClient = ReturnType<typeof getDb>;

let _initialised = false;

export async function ensureDb(): Promise<DbClient> {
  const client = getDb();
  if (!_initialised) {
    runMigrations(client); // accepts BetterSQLite3Database<any>
    await seedDemoScenarios(); // no-op when data exists or mode ≠ demo
    _initialised = true;
  }
  return client;
}
