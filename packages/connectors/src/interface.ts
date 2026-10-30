import type { TimelineEvent } from "@necro-ops/core";

export interface CollectWindow {
  /** Already padded start time */
  start: Date;
  /** Already padded end time */
  end: Date;
  services: string[];
}

/** Raw data item returned by a connector before normalization. */
export type RawItem = Record<string, unknown>;

export interface Connector {
  id: "datadog" | "k8s" | "terraform" | "slack" | "mock";
  isEnabled(env: NodeJS.ProcessEnv): boolean;
  collect(window: CollectWindow, signal: AbortSignal): Promise<RawItem[]>;
  normalize(item: RawItem): TimelineEvent | null; // null = drop
}
