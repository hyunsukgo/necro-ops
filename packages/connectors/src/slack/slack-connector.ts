/**
 * slack-connector.ts — Slack read-only connector (task 6.4).
 *
 * Pulls a single channel's **conversation history** for an incident window and
 * converts the messages into `TimelineEvent`s — the human side of the autopsy
 * (e.g. the rollback discussion in demo scenario c).
 *
 * Design (per the task contract, mirrors the other connectors):
 *   - `collect()` is the only part that touches the network. It is a thin
 *     `fetch` wrapper over the Slack Web API's `conversations.history` method —
 *     the official SDK (`@slack/web-api`) is deliberately NOT a dependency.
 *   - `normalize()` is a PURE function (see ./normalize.ts): it never makes a
 *     request and needs no credentials, so tests validate it with raw fixtures
 *     alone and never exercise `collect()`.
 *   - Read-only: only the read-only `conversations.history` endpoint is called;
 *     nothing is ever posted back to Slack (requirement 2.6, product scope).
 *
 * Config comes from the environment:
 *   - SLACK_BOT_TOKEN  — bot token (xoxb-…); presence enables the connector
 *   - SLACK_CHANNEL_ID — the single channel to read (C…)
 * When `SLACK_BOT_TOKEN` is absent, `isEnabled` returns false and the
 * orchestrator marks the connector `skipped` (not an error). Demo mode has no
 * token, so the connector is skipped and `collect()` is never called.
 */

import type { Connector, CollectWindow, RawItem } from "../interface.js";
import type { TimelineEvent } from "@necro-ops/core";
import { normalizeSlack, SLACK_CHANNEL_FIELD } from "./normalize.js";

export const SLACK_TOKEN_ENV = "SLACK_BOT_TOKEN";
export const SLACK_CHANNEL_ENV = "SLACK_CHANNEL_ID";

const HISTORY_URL = "https://slack.com/api/conversations.history";
/** Cap pages so a busy channel cannot loop forever within the window. */
const MAX_PAGES = 10;

/** Slack ts is epoch-seconds-with-fraction; the API wants a string. */
function toSlackTs(date: Date): string {
  return (date.getTime() / 1000).toFixed(6);
}

export const slackConnector: Connector = {
  id: "slack",

  /**
   * Enabled when a Slack bot token is configured. We only check for the token's
   * presence — the actual request is a collect() concern. Demo mode has no
   * token, so the connector is skipped.
   */
  isEnabled(env: NodeJS.ProcessEnv): boolean {
    return Boolean(env[SLACK_TOKEN_ENV]);
  },

  /**
   * Fetch `conversations.history` for the configured channel, bounded to the
   * incident window via `oldest`/`latest`, following `next_cursor` pagination.
   * Honours the AbortSignal for the orchestrator's per-connector timeout.
   * Returns raw messages stamped with the channel; normalization happens
   * separately in `normalize()`.
   */
  async collect(window: CollectWindow, signal: AbortSignal): Promise<RawItem[]> {
    if (signal.aborted) {
      throw new DOMException("Collect aborted", "AbortError");
    }
    const env = process.env;
    const token = env[SLACK_TOKEN_ENV];
    const channel = env[SLACK_CHANNEL_ENV]?.trim();
    if (!token) {
      throw new Error(`${SLACK_TOKEN_ENV} is not set; cannot reach the Slack API`);
    }
    if (!channel) {
      throw new Error(`${SLACK_CHANNEL_ENV} is not set; no channel to read`);
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };

    const raw: RawItem[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(HISTORY_URL);
      url.searchParams.set("channel", channel);
      url.searchParams.set("oldest", toSlackTs(window.start));
      url.searchParams.set("latest", toSlackTs(window.end));
      url.searchParams.set("inclusive", "true");
      url.searchParams.set("limit", "200");
      if (cursor) url.searchParams.set("cursor", cursor);

      const res = await fetch(url, { headers, signal });
      if (!res.ok) {
        throw new Error(
          `Slack conversations.history failed: ${res.status} ${res.statusText}`,
        );
      }
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        messages?: unknown[];
        response_metadata?: { next_cursor?: string };
      };
      if (!body.ok) {
        throw new Error(`Slack API error: ${body.error ?? "unknown_error"}`);
      }

      for (const msg of body.messages ?? []) {
        if (typeof msg === "object" && msg !== null) {
          raw.push({ ...(msg as Record<string, unknown>), [SLACK_CHANNEL_FIELD]: channel });
        }
      }

      cursor = body.response_metadata?.next_cursor || undefined;
      if (!cursor) break;
    }

    return raw;
  },

  /** Pure normalizer — delegates to ./normalize.ts. */
  normalize(item: RawItem): TimelineEvent | null {
    return normalizeSlack(item);
  },
};
