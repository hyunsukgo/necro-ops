/**
 * Task 2.1 — Unit tests for domain types and zod schemas.
 * Requirement 3.1: every TimelineEvent field must be validated correctly.
 */
import { describe, it, expect } from "vitest";
import {
  EntitySchema,
  TimelineEventSchema,
  ClusterSchema,
  TimelineSchema,
  IncidentSchema,
  IncidentStatusSchema,
  CreateIncidentInputSchema,
  CitedStatementSchema,
  ActionItemSchema,
  ReportSchema,
  SourceSchema,
  EventKindSchema,
  SeveritySchema,
} from "./schemas.js";
import type {
  Source,
  EventKind,
  Severity,
  Entity,
  TimelineEvent,
  Cluster,
  Timeline,
  Incident,
  Report,
} from "./types.js";

// ── Literal union coverage ────────────────────────────────────────────────────

describe("SourceSchema", () => {
  const validSources: Source[] = ["datadog", "k8s", "terraform", "slack", "mock"];
  it.each(validSources)("accepts '%s'", (s) => {
    expect(() => SourceSchema.parse(s)).not.toThrow();
  });

  it("rejects an unknown source", () => {
    expect(() => SourceSchema.parse("pagerduty")).toThrow();
  });
});

describe("EventKindSchema", () => {
  const validKinds: EventKind[] = [
    "alert",
    "metric_anomaly",
    "log",
    "k8s_event",
    "deploy",
    "infra_change",
    "chat",
    "recovery",
  ];
  it.each(validKinds)("accepts '%s'", (k) => {
    expect(() => EventKindSchema.parse(k)).not.toThrow();
  });

  it("rejects an unknown kind", () => {
    expect(() => EventKindSchema.parse("unknown_kind")).toThrow();
  });
});

describe("SeveritySchema", () => {
  const validSeverities: Severity[] = ["info", "warning", "critical"];
  it.each(validSeverities)("accepts '%s'", (s) => {
    expect(() => SeveritySchema.parse(s)).not.toThrow();
  });

  it("rejects an unknown severity", () => {
    expect(() => SeveritySchema.parse("low")).toThrow();
  });
});

// ── EntitySchema ──────────────────────────────────────────────────────────────

describe("EntitySchema", () => {
  const validTypes: Entity["type"][] = ["service", "namespace", "pod", "resource"];

  it.each(validTypes)("accepts type '%s'", (t) => {
    expect(() => EntitySchema.parse({ type: t, name: "my-thing" })).not.toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => EntitySchema.parse({ type: "service", name: "" })).toThrow();
  });

  it("rejects missing type", () => {
    expect(() => EntitySchema.parse({ name: "payment-api" })).toThrow();
  });

  it("rejects unknown entity type", () => {
    expect(() => EntitySchema.parse({ type: "cluster", name: "prod" })).toThrow();
  });
});

// ── TimelineEventSchema ───────────────────────────────────────────────────────

const baseEvent: TimelineEvent = {
  id: "mock:evt-001",
  source: "mock",
  timestamp: "2024-10-31T10:00:00.000Z",
  kind: "alert",
  severity: "critical",
  entities: [{ type: "service", name: "payment-api" }],
  summary: "Payment service returned 500 errors",
  raw: { original: true },
};

describe("TimelineEventSchema", () => {
  it("accepts a fully-populated event", () => {
    expect(() => TimelineEventSchema.parse(baseEvent)).not.toThrow();
  });

  it("accepts an event with an optional link", () => {
    const withLink = { ...baseEvent, link: "https://app.datadoghq.com/event/1" };
    const parsed = TimelineEventSchema.parse(withLink);
    expect(parsed.link).toBe("https://app.datadoghq.com/event/1");
  });

  it("omits link when not provided (optional)", () => {
    const parsed = TimelineEventSchema.parse(baseEvent);
    expect(parsed.link).toBeUndefined();
  });

  it("rejects a link that is not a valid URL", () => {
    expect(() =>
      TimelineEventSchema.parse({ ...baseEvent, link: "not-a-url" })
    ).toThrow();
  });

  it("rejects a summary longer than 200 chars", () => {
    expect(() =>
      TimelineEventSchema.parse({ ...baseEvent, summary: "x".repeat(201) })
    ).toThrow();
  });

  it("accepts a summary of exactly 200 chars", () => {
    expect(() =>
      TimelineEventSchema.parse({ ...baseEvent, summary: "x".repeat(200) })
    ).not.toThrow();
  });

  it("rejects a non-ISO timestamp", () => {
    expect(() =>
      TimelineEventSchema.parse({ ...baseEvent, timestamp: "October 31 2024" })
    ).toThrow();
  });

  it("accepts a timestamp with timezone offset", () => {
    const withOffset = { ...baseEvent, timestamp: "2024-10-31T10:00:00+09:00" };
    expect(() => TimelineEventSchema.parse(withOffset)).not.toThrow();
  });

  it("id follows the source:nativeId convention (runtime check)", () => {
    const parsed = TimelineEventSchema.parse(baseEvent);
    expect(parsed.id).toMatch(/^[^:]+:.+$/);
  });

  it("accepts raw as any unknown value including null", () => {
    expect(() => TimelineEventSchema.parse({ ...baseEvent, raw: null })).not.toThrow();
    expect(() => TimelineEventSchema.parse({ ...baseEvent, raw: [1, 2, 3] })).not.toThrow();
    expect(() => TimelineEventSchema.parse({ ...baseEvent, raw: "string-raw" })).not.toThrow();
  });

  it("rejects missing required fields", () => {
    const { id: _id, ...withoutId } = baseEvent;
    expect(() => TimelineEventSchema.parse(withoutId)).toThrow();

    const { source: _source, ...withoutSource } = baseEvent;
    expect(() => TimelineEventSchema.parse(withoutSource)).toThrow();

    const { timestamp: _ts, ...withoutTs } = baseEvent;
    expect(() => TimelineEventSchema.parse(withoutTs)).toThrow();
  });

  it("accepts multiple entities", () => {
    const multiEntity = {
      ...baseEvent,
      entities: [
        { type: "service", name: "payment-api" },
        { type: "namespace", name: "production" },
        { type: "pod", name: "payment-api-xyz" },
      ],
    };
    const parsed = TimelineEventSchema.parse(multiEntity);
    expect(parsed.entities).toHaveLength(3);
  });

  it("accepts an empty entities array", () => {
    expect(() =>
      TimelineEventSchema.parse({ ...baseEvent, entities: [] })
    ).not.toThrow();
  });
});

// ── ClusterSchema ─────────────────────────────────────────────────────────────

const baseCluster: Cluster = {
  id: "cluster-1",
  eventIds: ["mock:evt-001", "mock:evt-002"],
  entities: [{ type: "service", name: "payment-api" }],
  start: "2024-10-31T10:00:00.000Z",
  end: "2024-10-31T10:05:00.000Z",
};

describe("ClusterSchema", () => {
  it("accepts a valid cluster", () => {
    expect(() => ClusterSchema.parse(baseCluster)).not.toThrow();
  });

  it("accepts a cluster with no eventIds", () => {
    expect(() => ClusterSchema.parse({ ...baseCluster, eventIds: [] })).not.toThrow();
  });

  it("rejects a non-ISO start timestamp", () => {
    expect(() =>
      ClusterSchema.parse({ ...baseCluster, start: "not-a-date" })
    ).toThrow();
  });

  it("rejects a non-ISO end timestamp", () => {
    expect(() =>
      ClusterSchema.parse({ ...baseCluster, end: "not-a-date" })
    ).toThrow();
  });

  it("rejects missing id", () => {
    const { id: _id, ...withoutId } = baseCluster;
    expect(() => ClusterSchema.parse(withoutId)).toThrow();
  });
});

// ── TimelineSchema ────────────────────────────────────────────────────────────

describe("TimelineSchema", () => {
  it("accepts a timeline with events, clusters, and suspected trigger", () => {
    const timeline: Timeline = {
      events: [baseEvent],
      clusters: [baseCluster],
      suspectedTriggerId: "mock:evt-001",
    };
    expect(() => TimelineSchema.parse(timeline)).not.toThrow();
  });

  it("accepts a timeline without a suspectedTriggerId", () => {
    const timeline: Timeline = { events: [], clusters: [] };
    expect(() => TimelineSchema.parse(timeline)).not.toThrow();
  });

  it("accepts a timeline with empty arrays", () => {
    expect(() => TimelineSchema.parse({ events: [], clusters: [] })).not.toThrow();
  });

  it("rejects a timeline missing events array", () => {
    expect(() => TimelineSchema.parse({ clusters: [] })).toThrow();
  });

  it("rejects invalid events within the array", () => {
    expect(() =>
      TimelineSchema.parse({ events: [{ id: "bad", source: "UNKNOWN" }], clusters: [] })
    ).toThrow();
  });
});

// ── IncidentStatusSchema ──────────────────────────────────────────────────────

describe("IncidentStatusSchema", () => {
  const validStatuses: Incident["status"][] = [
    "pending",
    "exhuming",
    "exhumed",
    "autopsied",
    "failed",
  ];

  it.each(validStatuses)("accepts '%s'", (s) => {
    expect(() => IncidentStatusSchema.parse(s)).not.toThrow();
  });

  it("rejects unknown status", () => {
    expect(() => IncidentStatusSchema.parse("running")).toThrow();
  });
});

// ── IncidentSchema ────────────────────────────────────────────────────────────

const baseIncident: Incident = {
  id: "inc-001",
  title: "Payment API outage",
  startAt: "2024-10-31T09:00:00.000Z",
  endAt: "2024-10-31T11:00:00.000Z",
  services: ["payment-api"],
  status: "pending",
  createdAt: "2024-10-31T09:05:00.000Z",
};

describe("IncidentSchema", () => {
  it("accepts a valid incident", () => {
    expect(() => IncidentSchema.parse(baseIncident)).not.toThrow();
  });

  it("accepts multiple services", () => {
    const multi = { ...baseIncident, services: ["payment-api", "order-service"] };
    const parsed = IncidentSchema.parse(multi);
    expect(parsed.services).toHaveLength(2);
  });

  it("rejects an empty title", () => {
    expect(() => IncidentSchema.parse({ ...baseIncident, title: "" })).toThrow();
  });

  it("rejects a title longer than 255 chars", () => {
    expect(() =>
      IncidentSchema.parse({ ...baseIncident, title: "x".repeat(256) })
    ).toThrow();
  });

  it("rejects an empty services array", () => {
    expect(() => IncidentSchema.parse({ ...baseIncident, services: [] })).toThrow();
  });

  it("rejects a service with empty string", () => {
    expect(() =>
      IncidentSchema.parse({ ...baseIncident, services: [""] })
    ).toThrow();
  });
});

// ── CreateIncidentInputSchema ─────────────────────────────────────────────────

describe("CreateIncidentInputSchema", () => {
  const validInput = {
    title: "Outage",
    startAt: "2024-10-31T09:00:00.000Z",
    endAt: "2024-10-31T11:00:00.000Z",
    services: ["payment-api"],
  };

  it("accepts valid input", () => {
    expect(() => CreateIncidentInputSchema.parse(validInput)).not.toThrow();
  });

  it("rejects when endAt equals startAt", () => {
    const equal = { ...validInput, endAt: validInput.startAt };
    expect(CreateIncidentInputSchema.safeParse(equal).success).toBe(false);
  });

  it("rejects when endAt is before startAt", () => {
    const backwards = {
      ...validInput,
      startAt: "2024-10-31T11:00:00.000Z",
      endAt: "2024-10-31T09:00:00.000Z",
    };
    expect(CreateIncidentInputSchema.safeParse(backwards).success).toBe(false);
  });

  it("rejects empty services", () => {
    expect(
      CreateIncidentInputSchema.safeParse({ ...validInput, services: [] }).success
    ).toBe(false);
  });

  it("includes path 'endAt' in the error when end is before start", () => {
    const result = CreateIncidentInputSchema.safeParse({
      ...validInput,
      startAt: "2024-10-31T11:00:00.000Z",
      endAt: "2024-10-31T09:00:00.000Z",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("endAt");
    }
  });
});

// ── CitedStatementSchema ──────────────────────────────────────────────────────

describe("CitedStatementSchema", () => {
  it("accepts a valid cited statement", () => {
    expect(() =>
      CitedStatementSchema.parse({ text: "Memory was exhausted.", citations: ["mock:evt-1"] })
    ).not.toThrow();
  });

  it("rejects empty citations array", () => {
    expect(() =>
      CitedStatementSchema.parse({ text: "Some cause.", citations: [] })
    ).toThrow();
  });

  it("rejects empty text", () => {
    expect(() =>
      CitedStatementSchema.parse({ text: "", citations: ["mock:evt-1"] })
    ).toThrow();
  });

  it("accepts multiple citations", () => {
    const parsed = CitedStatementSchema.parse({
      text: "Two things happened.",
      citations: ["mock:evt-1", "k8s:evt-2"],
    });
    expect(parsed.citations).toHaveLength(2);
  });
});

// ── ActionItemSchema ──────────────────────────────────────────────────────────

describe("ActionItemSchema", () => {
  it.each(["prevent", "detect", "mitigate"] as const)("accepts type '%s'", (t) => {
    expect(() =>
      ActionItemSchema.parse({ title: "Fix it", type: t, priority: "P1" })
    ).not.toThrow();
  });

  it.each(["P1", "P2", "P3"] as const)("accepts priority '%s'", (p) => {
    expect(() =>
      ActionItemSchema.parse({ title: "Fix it", type: "prevent", priority: p })
    ).not.toThrow();
  });

  it("rejects unknown type", () => {
    expect(() =>
      ActionItemSchema.parse({ title: "Fix it", type: "avoid", priority: "P1" })
    ).toThrow();
  });

  it("rejects unknown priority", () => {
    expect(() =>
      ActionItemSchema.parse({ title: "Fix it", type: "prevent", priority: "P4" })
    ).toThrow();
  });

  it("rejects empty title", () => {
    expect(() =>
      ActionItemSchema.parse({ title: "", type: "prevent", priority: "P1" })
    ).toThrow();
  });
});

// ── ReportSchema ──────────────────────────────────────────────────────────────

const baseReport: Report = {
  incidentId: "inc-001",
  summary: "A brief outage occurred.",
  causeOfDeath: [
    { text: "Memory limits were too low.", citations: ["mock:evt-001"] },
  ],
  contributingFactors: [
    { text: "No autoscaling configured.", citations: ["mock:evt-002"] },
  ],
  timeline: "## Timeline\n\n- 10:00 — Alert fired",
  impact: "5% of requests failed for 30 minutes.",
  detectionAndResponse: "Automated alert triggered within 2 minutes.",
  actionItems: [
    { title: "Raise memory limits", type: "prevent", priority: "P1" },
  ],
  isDraft: true,
  generatedBy: "template",
  updatedAt: "2024-10-31T12:00:00.000Z",
};

describe("ReportSchema", () => {
  it("accepts a fully-populated report", () => {
    expect(() => ReportSchema.parse(baseReport)).not.toThrow();
  });

  it.each(["bedrock", "template", "user"] as const)(
    "accepts generatedBy '%s'",
    (g) => {
      expect(() => ReportSchema.parse({ ...baseReport, generatedBy: g })).not.toThrow();
    }
  );

  it("rejects unknown generatedBy value", () => {
    expect(() =>
      ReportSchema.parse({ ...baseReport, generatedBy: "human" })
    ).toThrow();
  });

  it("accepts isDraft = false", () => {
    const parsed = ReportSchema.parse({ ...baseReport, isDraft: false });
    expect(parsed.isDraft).toBe(false);
  });

  it("rejects an empty summary", () => {
    expect(() => ReportSchema.parse({ ...baseReport, summary: "" })).toThrow();
  });

  it("rejects a causeOfDeath statement with empty citations", () => {
    expect(() =>
      ReportSchema.parse({
        ...baseReport,
        causeOfDeath: [{ text: "Something happened.", citations: [] }],
      })
    ).toThrow();
  });

  it("accepts zero causeOfDeath statements (template may emit an empty array)", () => {
    expect(() =>
      ReportSchema.parse({ ...baseReport, causeOfDeath: [] })
    ).not.toThrow();
  });

  it("rejects a non-ISO updatedAt", () => {
    expect(() =>
      ReportSchema.parse({ ...baseReport, updatedAt: "yesterday" })
    ).toThrow();
  });
});
