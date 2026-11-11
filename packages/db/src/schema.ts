// Drizzle ORM schema — SQLite (better-sqlite3)
// Tables: incidents, connector_runs, events, timelines, reports

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ── incidents ────────────────────────────────────────────────────────────────

export const incidents = sqliteTable("incidents", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  startAt: text("start_at").notNull(), // UTC ISO-8601
  endAt: text("end_at").notNull(), // UTC ISO-8601
  servicesJson: text("services_json").notNull().default("[]"), // JSON string[]
  status: text("status", {
    enum: ["pending", "exhuming", "exhumed", "autopsied", "failed"],
  })
    .notNull()
    .default("pending"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ── connector_runs ───────────────────────────────────────────────────────────

export const connectorRuns = sqliteTable("connector_runs", {
  id: text("id").primaryKey(),
  incidentId: text("incident_id")
    .notNull()
    .references(() => incidents.id, { onDelete: "cascade" }),
  connector: text("connector", {
    enum: ["datadog", "k8s", "terraform", "slack", "mock"],
  }).notNull(),
  status: text("status", {
    enum: ["pending", "running", "done", "skipped", "failed"],
  })
    .notNull()
    .default("pending"),
  error: text("error"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  itemCount: integer("item_count").notNull().default(0),
});

// ── events ───────────────────────────────────────────────────────────────────

export const events = sqliteTable("events", {
  id: text("id").primaryKey(), // `${source}:${nativeId}`
  incidentId: text("incident_id")
    .notNull()
    .references(() => incidents.id, { onDelete: "cascade" }),
  source: text("source", {
    enum: ["datadog", "k8s", "terraform", "slack", "mock"],
  }).notNull(),
  ts: text("ts").notNull(), // UTC ISO-8601
  kind: text("kind", {
    enum: [
      "alert",
      "metric_anomaly",
      "log",
      "k8s_event",
      "deploy",
      "infra_change",
      "chat",
      "recovery",
    ],
  }).notNull(),
  severity: text("severity", {
    enum: ["info", "warning", "critical"],
  }).notNull(),
  entitiesJson: text("entities_json").notNull().default("[]"), // JSON Entity[]
  summary: text("summary").notNull(),
  link: text("link"),
  rawJson: text("raw_json").notNull().default("null"), // JSON unknown
});

// ── timelines ────────────────────────────────────────────────────────────────

export const timelines = sqliteTable("timelines", {
  incidentId: text("incident_id")
    .primaryKey()
    .references(() => incidents.id, { onDelete: "cascade" }),
  clustersJson: text("clusters_json").notNull().default("[]"), // JSON Cluster[]
  suspectedTriggerId: text("suspected_trigger_id"),
  builtAt: text("built_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ── reports ──────────────────────────────────────────────────────────────────

export const reports = sqliteTable("reports", {
  incidentId: text("incident_id")
    .primaryKey()
    .references(() => incidents.id, { onDelete: "cascade" }),
  bodyJson: text("body_json").notNull(), // JSON Report body
  isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(true),
  generatedBy: text("generated_by", {
    enum: ["bedrock", "template", "user"],
  })
    .notNull()
    .default("template"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ── Type inference helpers ────────────────────────────────────────────────────

export type IncidentRow = typeof incidents.$inferSelect;
export type NewIncidentRow = typeof incidents.$inferInsert;
export type ConnectorRunRow = typeof connectorRuns.$inferSelect;
export type NewConnectorRunRow = typeof connectorRuns.$inferInsert;
export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
export type TimelineRow = typeof timelines.$inferSelect;
export type NewTimelineRow = typeof timelines.$inferInsert;
export type ReportRow = typeof reports.$inferSelect;
export type NewReportRow = typeof reports.$inferInsert;
