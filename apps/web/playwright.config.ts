import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Playwright config for the Necro-Ops demo flow (Task 9.1).
 *
 * Runs the Next.js app in demo mode against a throwaway SQLite database so the
 * mock scenarios are auto-seeded on first request. The webServer block boots
 * `next dev` and waits for it to be reachable before the tests run.
 */

const DEMO_DB = join(tmpdir(), "necro-e2e.db");
const PORT = 3123;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Use a production build for a stable, fast server (no on-demand compile).
    command: `pnpm exec next build && pnpm exec next start --port ${PORT}`,
    url: `http://localhost:${PORT}/morgue`,
    reuseExistingServer: !process.env["CI"],
    timeout: 180_000,
    env: {
      NECRO_MODE: "demo",
      DATABASE_URL: DEMO_DB,
    },
  },
});
