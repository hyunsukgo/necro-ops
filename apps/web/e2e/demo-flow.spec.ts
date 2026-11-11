import { test, expect } from "@playwright/test";

/**
 * Task 9.1 — end-to-end demo flow.
 *
 * Scenario (a): OOMKilled pods after a Terraform memory-limit change.
 *
 * Flow:
 *   1. Open the Morgue — the seeded scenarios should be listed.
 *   2. Open the OOMKilled incident.
 *   3. Verify the stitched timeline rendered with the suspected-trigger badge.
 *   4. Perform the autopsy (template generator in demo mode).
 *   5. Verify the report renders a "Cause of Death" section.
 *   6. Export the Markdown and verify it contains "Cause of Death".
 *
 * The app runs in demo mode (NECRO_MODE=demo) so the three fixture scenarios
 * are auto-seeded into a throwaway SQLite DB on first request.
 */

test.describe("Necro-Ops demo flow", () => {
  test("morgue lists seeded scenarios", async ({ page }) => {
    await page.goto("/morgue");
    await expect(
      page.getByRole("heading", { name: /The Morgue/i }),
    ).toBeVisible();

    // At least the OOMKilled tombstone should be present
    await expect(page.getByText(/OOMKilled/i).first()).toBeVisible();
  });

  test("open incident → exhume → autopsy → export contains Cause of Death", async ({
    page,
  }) => {
    await page.goto("/morgue");

    // 2. Open the OOMKilled incident. The tombstone is a link wrapping the title.
    const oomLink = page.getByRole("link").filter({ hasText: /OOMKilled/i }).first();
    await expect(oomLink).toBeVisible();
    await oomLink.click();
    await expect(page).toHaveURL(/\/incidents\//, { timeout: 15_000 });

    // 3. The stitched timeline should render with events + trigger badge.
    //    Seeded scenarios already have events, so the timeline is populated.
    await expect(
      page.getByRole("heading", { name: /Stitched Timeline/i }),
    ).toBeVisible();
    await expect(
      page.getByText(/suspected trigger/i).first(),
    ).toBeVisible();

    // 4. Perform the autopsy if it hasn't been generated yet. The incident is
    //    seeded as "exhumed", so on a fresh DB the "Perform Autopsy" button is
    //    shown. If a report already exists (e.g. a re-run against the same DB),
    //    the button won't be present — that's fine, we just verify the report.
    const autopsyButton = page.getByRole("button", {
      name: /Perform Autopsy/i,
    });
    if (await autopsyButton.isVisible().catch(() => false)) {
      await autopsyButton.click();
    }

    // 5. The report renders with a Cause of Death section.
    await expect(
      page.getByRole("heading", { name: /Cause of Death/i }),
    ).toBeVisible({ timeout: 30_000 });

    // 6. Export the Markdown. The export link points to /report.md.
    //    Fetch it directly and assert its contents.
    const url = page.url();
    const match = url.match(/\/incidents\/([^/?#]+)/);
    expect(match).not.toBeNull();
    const incidentId = match![1];

    const res = await page.request.get(
      `/api/incidents/${incidentId}/report.md`,
    );
    expect(res.ok()).toBeTruthy();
    const markdown = await res.text();
    expect(markdown).toContain("Cause of Death");
    expect(markdown).toContain("# Autopsy Report");
    // Req 6.2 — exported markdown must not contain raw payloads
    expect(markdown).not.toContain("run_id");
    expect(markdown).not.toContain("monitor_id");
  });
});
