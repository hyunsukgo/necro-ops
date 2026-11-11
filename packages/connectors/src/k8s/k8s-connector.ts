/**
 * k8s-connector.ts — Kubernetes read-only connector (task 6.2).
 *
 * Pulls Kubernetes **cluster events** (core/v1 Event) and **pod status**
 * (core/v1 Pod) for the services in an incident window and converts them into
 * `TimelineEvent`s.
 *
 * Design (per the task contract, mirrors the Datadog connector):
 *   - `collect()` is the only part that touches the network. It is a thin
 *     `fetch` wrapper over the Kubernetes REST API — the official SDK
 *     (`@kubernetes/client-node`) is deliberately NOT a dependency.
 *   - `normalize()` is a PURE function (see ./normalize.ts): it never makes a
 *     request and needs no credentials, so tests validate it with raw fixtures
 *     alone and never exercise `collect()`.
 *   - Read-only: only GET requests to the events and pods list endpoints.
 *
 * Access config comes from the environment:
 *   - KUBECONFIG         — presence enables the connector (path to kubeconfig)
 *   - K8S_API_SERVER     — API server base URL (e.g. https://1.2.3.4:6443)
 *   - K8S_TOKEN          — bearer token for the API server
 *   - K8S_NAMESPACE      — namespace to query (defaults to "default")
 * When `KUBECONFIG` is absent, `isEnabled` returns false and the orchestrator
 * marks the connector `skipped` (not an error). The full kubeconfig parse is a
 * live-mode concern; demo mode never calls `collect()`.
 */

import { isLiveMode, type Connector, type CollectWindow, type RawItem } from "../interface.js";
import type { TimelineEvent } from "@necro-ops/core";
import { normalizeK8s, K8S_EVENT, K8S_POD } from "./normalize.js";

const DEFAULT_NAMESPACE = "default";

function authHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = env["K8S_TOKEN"];
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

/** Stamp a synthetic `_k8sType` so normalize() can discriminate the shape. */
function stamp(items: unknown[], type: string): RawItem[] {
  const out: RawItem[] = [];
  for (const item of items) {
    if (typeof item === "object" && item !== null) {
      out.push({ ...(item as Record<string, unknown>), _k8sType: type });
    }
  }
  return out;
}

export const k8sConnector: Connector = {
  id: "k8s",

  /**
   * Enabled when a kubeconfig is configured. We only check for the presence of
   * k8s access config (KUBECONFIG) — the actual connection is a collect()
   * concern. Demo mode has no KUBECONFIG, so the connector is skipped.
   */
  isEnabled(env: NodeJS.ProcessEnv): boolean {
    return isLiveMode(env) && Boolean(env["KUBECONFIG"]);
  },

  /**
   * Fetch core/v1 events and pods from the Kubernetes API for the configured
   * namespace. Honours the AbortSignal for the orchestrator's per-connector
   * timeout. Returns raw items stamped with `_k8sType`; normalization happens
   * separately in `normalize()`.
   *
   * The event list is not natively windowed by the API, so windowing is left
   * to the normalizer + timeline builder (events carry their own timestamps).
   */
  async collect(window: CollectWindow, signal: AbortSignal): Promise<RawItem[]> {
    if (signal.aborted) {
      throw new DOMException("Collect aborted", "AbortError");
    }
    const env = process.env;
    const apiServer = env["K8S_API_SERVER"];
    if (!apiServer) {
      throw new Error(
        "K8S_API_SERVER is not set; cannot reach the Kubernetes API",
      );
    }
    const base = apiServer.replace(/\/+$/, "");
    const ns = env["K8S_NAMESPACE"]?.trim() || DEFAULT_NAMESPACE;
    const headers = authHeaders(env);

    const eventsUrl = `${base}/api/v1/namespaces/${ns}/events`;
    const podsUrl = `${base}/api/v1/namespaces/${ns}/pods`;

    const [eventsRes, podsRes] = await Promise.all([
      fetch(eventsUrl, { headers, signal }),
      fetch(podsUrl, { headers, signal }),
    ]);

    const raw: RawItem[] = [];

    if (eventsRes.ok) {
      const body = (await eventsRes.json()) as { items?: unknown[] };
      if (Array.isArray(body.items)) {
        raw.push(...stamp(body.items, K8S_EVENT));
      }
    } else {
      throw new Error(
        `Kubernetes events request failed: ${eventsRes.status} ${eventsRes.statusText}`,
      );
    }

    if (podsRes.ok) {
      const body = (await podsRes.json()) as { items?: unknown[] };
      if (Array.isArray(body.items)) {
        raw.push(...stamp(body.items, K8S_POD));
      }
    } else {
      throw new Error(
        `Kubernetes pods request failed: ${podsRes.status} ${podsRes.statusText}`,
      );
    }

    // Window is enforced downstream by the timeline builder; `services` is a
    // caller hint we do not filter on here so recovery events outside the
    // service tag set are still captured.
    void window;

    return raw;
  },

  /** Pure normalizer — delegates to ./normalize.ts. */
  normalize(item: RawItem): TimelineEvent | null {
    return normalizeK8s(item);
  },
};
