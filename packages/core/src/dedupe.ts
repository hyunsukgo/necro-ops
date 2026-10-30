/**
 * dedupe.ts — deduplication for normalised timeline events.
 *
 * Requirement 3.3: when the same event is reported twice by a source,
 * deduplicate it by source and source-native id.
 *
 * The `TimelineEvent.id` field is already encoded as `${source}:${nativeId}`,
 * so a simple Map keyed on `id` is all we need.
 *
 * The function is pure and deterministic: given the same input it always
 * returns the same output.  On duplicate ids, the first occurrence is kept.
 *
 * Must NOT import from any other package.
 */

import type { TimelineEvent } from "./types.js";

/**
 * Remove duplicate `TimelineEvent` objects from `events`.
 *
 * Two events are considered duplicates when they share the same `id`
 * (`${source}:${nativeId}`).  The first occurrence in the input array is
 * retained; subsequent duplicates are dropped.
 *
 * @param events - Array of normalised timeline events (may contain duplicates).
 * @returns A new array containing only the first occurrence of each unique id,
 *          preserving the original relative order.
 */
export function dedupe(events: TimelineEvent[]): TimelineEvent[] {
  const seen = new Set<string>();
  const result: TimelineEvent[] = [];

  for (const event of events) {
    if (!seen.has(event.id)) {
      seen.add(event.id);
      result.push(event);
    }
  }

  return result;
}
