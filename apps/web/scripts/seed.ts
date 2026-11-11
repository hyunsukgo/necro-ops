#!/usr/bin/env tsx
/**
 * seed.ts — manual demo seed entrypoint for the web app.
 *
 * Runs migrations then seeds the fixture scenarios into the SQLite database.
 * Usage: pnpm --filter web seed   (or `pnpm seed` from the repo root)
 *
 * Honours DATABASE_URL and NECRO_MODE from the environment. Safe to run
 * repeatedly — seeding is a no-op when incidents already exist.
 */

import { getDb, runMigrations, seedDemoScenarios } from "@necro-ops/db";

const db = getDb();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
runMigrations(db as any);
await seedDemoScenarios({ force: process.argv.includes("--force") });
console.log("[seed] Done.");
