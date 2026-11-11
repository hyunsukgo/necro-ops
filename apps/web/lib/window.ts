/**
 * lib/window.ts — collection window padding.
 *
 * Requirement 1.3: extend the window by a configurable padding.
 * Defaults: 30 min before start, 15 min after end.
 * Reads WINDOW_PAD_BEFORE and WINDOW_PAD_AFTER from the environment.
 */

export interface CollectWindow {
  start: Date;
  end: Date;
}

export function padWindow(start: Date, end: Date): CollectWindow {
  const padBefore = Number(process.env["WINDOW_PAD_BEFORE"] ?? 30);
  const padAfter = Number(process.env["WINDOW_PAD_AFTER"] ?? 15);

  return {
    start: new Date(start.getTime() - padBefore * 60 * 1_000),
    end: new Date(end.getTime() + padAfter * 60 * 1_000),
  };
}
