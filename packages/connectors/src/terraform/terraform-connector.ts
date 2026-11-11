/**
 * terraform-connector.ts — Terraform read-only connector (task 6.3).
 *
 * Reconstructs infrastructure changes around an incident from two file inputs
 * and converts them into `TimelineEvent`s. Unlike Datadog / Kubernetes, this
 * connector is NOT network-backed: its sources are uploaded files / local
 * paths, so `collect()` reads files rather than issuing HTTP requests.
 *
 *   (A) `terraform show -json` output (plan or state JSON) at
 *       `TERRAFORM_SHOW_JSON_PATH` — parsed for `resource_changes[]`.
 *   (B) a `terraform apply` text log at `TERRAFORM_APPLY_LOG_PATH` — scanned
 *       for per-resource Creation/Modification/Destruction lines and the final
 *       "Apply complete!" line, with timestamps.
 *
 * Design (per the task contract, mirrors the other connectors):
 *   - `collect()` is the only part that touches the filesystem. It reads the
 *     configured files, tokenises the apply log, stamps a `_tfType` (+ a
 *     `_tfTimestamp` anchor) onto every raw item, and returns them.
 *   - `normalize()` is a PURE function (see ./normalize.ts): no file reads, no
 *     env, no SDK — so tests validate it with raw fixtures alone and never
 *     exercise `collect()`.
 *   - Read-only: files are only ever read, never written.
 *
 * Config comes from the environment OR from collect()'s window (the paths may
 * also be injected in tests):
 *   - TERRAFORM_SHOW_JSON_PATH — path to `terraform show -json` output
 *   - TERRAFORM_APPLY_LOG_PATH — path to a `terraform apply` text log
 * When NEITHER is set, `isEnabled` returns false and the orchestrator marks the
 * connector `skipped` (not an error).
 */

import { readFile } from "node:fs/promises";
import type { Connector, CollectWindow, RawItem } from "../interface.js";
import type { TimelineEvent } from "@necro-ops/core";
import {
  normalizeTerraform,
  TF_CHANGE,
  TF_APPLY,
  parseApplyLog,
} from "./normalize.js";

export const SHOW_JSON_ENV = "TERRAFORM_SHOW_JSON_PATH";
export const APPLY_LOG_ENV = "TERRAFORM_APPLY_LOG_PATH";

function envPaths(env: NodeJS.ProcessEnv): {
  showJson?: string;
  applyLog?: string;
} {
  return {
    showJson: env[SHOW_JSON_ENV]?.trim() || undefined,
    applyLog: env[APPLY_LOG_ENV]?.trim() || undefined,
  };
}

/** Pull resource_changes out of `terraform show -json` output. */
function extractResourceChanges(json: unknown): Record<string, unknown>[] {
  if (typeof json !== "object" || json === null) return [];
  const changes = (json as { resource_changes?: unknown }).resource_changes;
  if (!Array.isArray(changes)) return [];
  return changes.filter(
    (c): c is Record<string, unknown> => typeof c === "object" && c !== null,
  );
}

export const terraformConnector: Connector = {
  id: "terraform",

  /**
   * Enabled when at least one source path is configured. The connector is
   * file-based, not network-based: presence of a path is enough. Demo mode has
   * neither path, so the connector is skipped.
   */
  isEnabled(env: NodeJS.ProcessEnv): boolean {
    const { showJson, applyLog } = envPaths(env);
    return Boolean(showJson || applyLog);
  },

  /**
   * Read the configured show-json and/or apply-log files, tokenise them, and
   * return raw items stamped with `_tfType` + `_tfTimestamp`. Normalisation
   * happens separately in `normalize()`.
   *
   * `show -json` output has no per-resource timestamp, so every change is
   * anchored to the incident window's start — the correlator refines ordering
   * against the apply-log lines, which do carry real timestamps.
   */
  async collect(window: CollectWindow, signal: AbortSignal): Promise<RawItem[]> {
    if (signal.aborted) {
      throw new DOMException("Collect aborted", "AbortError");
    }
    const { showJson, applyLog } = envPaths(process.env);
    const anchor = window.start.toISOString();
    const raw: RawItem[] = [];

    if (showJson) {
      const text = await readFile(showJson, "utf-8");
      const json = JSON.parse(text) as unknown;
      for (const change of extractResourceChanges(json)) {
        raw.push({ ...change, _tfType: TF_CHANGE, _tfTimestamp: anchor });
      }
    }

    if (applyLog) {
      const text = await readFile(applyLog, "utf-8");
      // Apply-log parsing lives in normalize.ts (pure) so it is unit-testable
      // without a file; collect() only supplies the window anchor for lines
      // whose own clock cannot be resolved.
      raw.push(...parseApplyLog(text, anchor));
    }

    return raw;
  },

  /** Pure normalizer — delegates to ./normalize.ts. */
  normalize(item: RawItem): TimelineEvent | null {
    return normalizeTerraform(item);
  },
};
