// Domain types for Necro-Ops core.
// This file must NOT import from any other package.

export type Source = "datadog" | "k8s" | "terraform" | "slack" | "mock";

export type EventKind =
  | "alert"
  | "metric_anomaly"
  | "log"
  | "k8s_event"
  | "deploy"
  | "infra_change"
  | "chat"
  | "recovery";

export type Severity = "info" | "warning" | "critical";

export interface Entity {
  type: "service" | "namespace" | "pod" | "resource";
  name: string;
}

export interface TimelineEvent {
  /** `${source}:${nativeId}` */
  id: string;
  source: Source;
  /** UTC ISO-8601 */
  timestamp: string;
  kind: EventKind;
  severity: Severity;
  entities: Entity[];
  /** Max 200 chars, redacted */
  summary: string;
  link?: string;
  /** Never exported to the user */
  raw: unknown;
}

export interface Cluster {
  id: string;
  eventIds: string[];
  entities: Entity[];
  /** UTC ISO-8601 */
  start: string;
  /** UTC ISO-8601 */
  end: string;
}

export interface Timeline {
  events: TimelineEvent[];
  clusters: Cluster[];
  suspectedTriggerId?: string;
}

// ── Incident domain ──────────────────────────────────────────────────────────

export type IncidentStatus =
  | "pending"
  | "exhuming"
  | "exhumed"
  | "autopsied"
  | "failed";

export interface Incident {
  id: string;
  title: string;
  /** UTC ISO-8601 */
  startAt: string;
  /** UTC ISO-8601 */
  endAt: string;
  services: string[];
  status: IncidentStatus;
  /** UTC ISO-8601 */
  createdAt: string;
}

// ── Report domain ────────────────────────────────────────────────────────────

export type ReportGenerator = "bedrock" | "template" | "user";

export interface CitedStatement {
  text: string;
  citations: string[]; // TimelineEvent ids
}

export interface ActionItem {
  title: string;
  type: "prevent" | "detect" | "mitigate";
  priority: "P1" | "P2" | "P3";
}

export interface Report {
  incidentId: string;
  summary: string;
  causeOfDeath: CitedStatement[];
  contributingFactors: CitedStatement[];
  timeline: string; // human-readable markdown fragment
  impact: string;
  detectionAndResponse: string;
  actionItems: ActionItem[];
  isDraft: boolean;
  generatedBy: ReportGenerator;
  /** UTC ISO-8601 */
  updatedAt: string;
}
