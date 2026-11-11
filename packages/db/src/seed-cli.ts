#!/usr/bin/env tsx
// CLI entrypoint: seed demo scenarios.
// Usage: pnpm --filter @necro-ops/db db:seed
// Pass --force to re-seed even when incidents exist.

import { getDb } from "./client.js";
import { runMigrations } from "./migrate.js";
import { seedDemoScenarios } from "./seed.js";

const force = process.argv.includes("--force");

// Ensure schema is up to date before seeding.
const db = getDb();
runMigrations(db);

await seedDemoScenarios({ force });
console.log("[seed] Done.");
