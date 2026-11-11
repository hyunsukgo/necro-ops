/**
 * lib/sse-client.ts — browser-side helper for consuming the exhume SSE stream.
 *
 * Usage:
 *   const stop = streamExhume(incidentId, {
 *     onProgress(result) { /* update UI chips *\/ },
 *     onComplete(result) { /* navigate / refresh *\/ },
 *     onError(msg)  { /* show toast *\/ },
 *   });
 *   // call stop() to forcibly close the connection
 */

import type { ConnectorResult, ExhumeResult } from "@/lib/exhume";

export interface ExhumeStreamHandlers {
  onProgress?: (result: ConnectorResult) => void;
  onComplete?: (result: ExhumeResult) => void;
  onError?: (message: string) => void;
}

/**
 * Open the SSE stream for the given incident's exhume run.
 *
 * Returns a `stop` function that closes the EventSource when called.
 * The EventSource is also closed automatically after a `complete` or `error`
 * event so callers don't need to clean up in the happy path.
 */
export function streamExhume(
  incidentId: string,
  handlers: ExhumeStreamHandlers,
): () => void {
  const url = `/api/incidents/${incidentId}/exhume/stream`;
  const es = new EventSource(url);

  es.addEventListener("progress", (e: MessageEvent<string>) => {
    try {
      const data = JSON.parse(e.data) as ConnectorResult;
      handlers.onProgress?.(data);
    } catch {
      // ignore parse errors
    }
  });

  es.addEventListener("complete", (e: MessageEvent<string>) => {
    try {
      const data = JSON.parse(e.data) as ExhumeResult;
      handlers.onComplete?.(data);
    } catch {
      // ignore parse errors
    }
    es.close();
  });

  es.addEventListener("error", (e: Event) => {
    // MessageEvent when the server sends `event: error`; generic Event on
    // network failure.
    let message = "Exhume stream error";
    if (e instanceof MessageEvent) {
      try {
        const data = JSON.parse(e.data as string) as { error?: string };
        message = data.error ?? message;
      } catch {
        // ignore
      }
    }
    handlers.onError?.(message);
    es.close();
  });

  return () => es.close();
}
