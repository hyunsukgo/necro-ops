/**
 * datadog-connector.ts — Datadog read-only connector (task 6.1).
 *
 * Pulls Datadog **events** and **monitors** that fall within an incident
 * window and converts them into `TimelineEvent`s.
 *
 * Design (per the task contract):
 *   - `collect()` is the only part that touches the network. It is a thin
 *     `fetch` wrapper over the Datadog v1 REST API — the official SDK
 *     (`@datadog/datadog-api-client`) is deliberately NOT a dependency.
 *   - `normalize()` is a PURE function (see ./normalize.ts): it never makes a
 *     request and needs no credentials, so tests validate it with raw fixtures
 *     alone and never exercise `collect()`.
 *   - Read-only: only GET requests to `events` and `monitor` are issued.
 *
 * Credentials come from the environment:
 *   - DATADOG_API_KEY  (DD-API-KEY header)
 *   - DATADOG_APP_KEY  (DD-APPLICATION-KEY header)
 *   - DATADOG_SITE     (optional; defaults to datadoghq.com)
 * When either key is absent, `isEnabled` returns false and the orchestrator
 * marks the connector `skipped` (not an error).
 */

import { isLiveMode, type Connector, type CollectWindow, type RawItem } from "../interface.js";
import type { TimelineEvent } from "@necro-ops/core";
import {
  normalizeDatadog,
  DD_EVENT,
  DD_MONITOR,
} from "./normalize.js";

const DEFAULT_SITE = "datadoghq.com";

function apiBase(env: NodeJS.ProcessEnv): string {
  const site = env["DATADOG_SITE"]?.trim() || DEFAULT_SITE;
  return `https://api.${site}`;
}

function authHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  return {
    "DD-API-KEY": env["DATADOG_API_KEY"] ?? "",
    "DD-APPLICATION-KEY": env["DATADOG_APP_KEY"] ?? "",
    Accept: "application/json",
  };
}

/** Stamp a synthetic `_ddType` so normalize() can discriminate the shape. */
function stamp(items: unknown[], type: string): RawItem[] {
  const out: RawItem[] = [];
  for (const item of items) {
    if (typeof item === "object" && item !== null) {
      out.push({ ...(item as Record<string, unknown>), _ddType: type });
    }
  }
  return out;
}

export const datadogConnector: Connector = {
  id: "datadog",

  /** Enabled only when both Datadog keys are present in the environment. */
  isEnabled(env: NodeJS.ProcessEnv): boolean {
    return isLiveMode(env) && Boolean(env["DATADOG_API_KEY"]) && Boolean(env["DATADOG_APP_KEY"]);
  },

  /**
   * Fetch events (windowed) and monitors from the Datadog v1 API.
   *
   * Uses the caller's env via `process.env`. Honours the AbortSignal for the
   * orchestrator's per-connector timeout. Returns raw items stamped with
   * `_ddType`; normalization happens separately in `normalize()`.
   */
  async collect(window: CollectWindow, signal: AbortSignal): Promise<RawItem[]> {
    if (signal.aborted) {
      throw new DOMException("Collect aborted", "AbortError");
    }
    const env = process.env;
    const base = apiBase(env);
    const headers = authHeaders(env);

    // Datadog events API expects unix seconds.
    const start = Math.floor(window.start.getTime() / 1000);
    const end = Math.floor(window.end.getTime() / 1000);

    const eventsUrl = `${base}/api/v1/events?start=${start}&end=${end}`;
    const monitorsUrl = `${base}/api/v1/monitor`;

    const [eventsRes, monitorsRes] = await Promise.all([
      fetch(eventsUrl, { headers, signal }),
      fetch(monitorsUrl, { headers, signal }),
    ]);

    const raw: RawItem[] = [];

    if (eventsRes.ok) {
      const body = (await eventsRes.json()) as { events?: unknown[] };
      if (Array.isArray(body.events)) {
        raw.push(...stamp(body.events, DD_EVENT));
      }
    } else {
      throw new Error(
        `Datadog events request failed: ${eventsRes.status} ${eventsRes.statusText}`,
      );
    }

    if (monitorsRes.ok) {
      const body = (await monitorsRes.json()) as unknown;
      if (Array.isArray(body)) {
        raw.push(...stamp(body, DD_MONITOR));
      }
    } else {
      throw new Error(
        `Datadog monitors request failed: ${monitorsRes.status} ${monitorsRes.statusText}`,
      );
    }

    return raw;
  },

  /** Pure normalizer — delegates to ./normalize.ts. */
  normalize(item: RawItem): TimelineEvent | null {
    return normalizeDatadog(item);
  },
};
