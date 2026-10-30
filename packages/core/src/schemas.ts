import { z } from "zod";

// Zod schemas mirroring the domain types.
// Kept as a separate file so downstream packages import types separately from runtime validators.

export const SourceSchema = z.enum(["datadog", "k8s", "terraform", "slack", "mock"]);

export const EventKindSchema = z.enum([
  "alert",
  "metric_anomaly",
  "log",
  "k8s_event",
  "deploy",
  "infra_change",
  "chat",
  "recovery",
]);

export const SeveritySchema = z.enum(["info", "warning", "critical"]);

export const EntitySchema = z.object({
  type: z.enum(["service", "namespace", "pod", "resource"]),
  name: z.string().min(1),
});

export const TimelineEventSchema = z.object({
  id: z.string().min(1),
  source: SourceSchema,
  timestamp: z.string().datetime({ offset: true }),
  kind: EventKindSchema,
  severity: SeveritySchema,
  entities: z.array(EntitySchema),
  summary: z.string().max(200),
  link: z.string().url().optional(),
  raw: z.unknown(),
});

export const ClusterSchema = z.object({
  id: z.string().min(1),
  eventIds: z.array(z.string()),
  entities: z.array(EntitySchema),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
});

export const TimelineSchema = z.object({
  events: z.array(TimelineEventSchema),
  clusters: z.array(ClusterSchema),
  suspectedTriggerId: z.string().optional(),
});

export const IncidentStatusSchema = z.enum([
  "pending",
  "exhuming",
  "exhumed",
  "autopsied",
  "failed",
]);

export const IncidentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(255),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  services: z.array(z.string().min(1)).min(1),
  status: IncidentStatusSchema,
  createdAt: z.string().datetime({ offset: true }),
});

export const ReportGeneratorSchema = z.enum(["bedrock", "template", "user"]);

export const CitedStatementSchema = z.object({
  text: z.string().min(1),
  citations: z.array(z.string()).min(1),
});

export const ActionItemSchema = z.object({
  title: z.string().min(1),
  type: z.enum(["prevent", "detect", "mitigate"]),
  priority: z.enum(["P1", "P2", "P3"]),
});

export const ReportSchema = z.object({
  incidentId: z.string().min(1),
  summary: z.string().min(1),
  causeOfDeath: z.array(CitedStatementSchema),
  contributingFactors: z.array(CitedStatementSchema),
  timeline: z.string(),
  impact: z.string(),
  detectionAndResponse: z.string(),
  actionItems: z.array(ActionItemSchema),
  isDraft: z.boolean(),
  generatedBy: ReportGeneratorSchema,
  updatedAt: z.string().datetime({ offset: true }),
});

export const CreateIncidentInputSchema = z
  .object({
    title: z.string().min(1).max(255),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    services: z.array(z.string().min(1)).min(1),
  })
  .refine((data) => new Date(data.endAt) > new Date(data.startAt), {
    message: "endAt must be after startAt",
    path: ["endAt"],
  });
