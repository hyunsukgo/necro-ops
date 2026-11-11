#!/usr/bin/env tsx
// CLI entrypoint: run pending Drizzle migrations.
// Usage: pnpm --filter @necro-ops/db db:migrate

import { getDb } from "./client.js";
import { runMigrations } from "./migrate.js";

const db = getDb();
runMigrations(db);
console.log("[migrate] All migrations applied.");
