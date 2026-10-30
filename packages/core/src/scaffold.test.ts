import { describe, it, expect } from "vitest";
import {
  TimelineEventSchema,
  ClusterSchema,
  TimelineSchema,
  IncidentSchema,
  CreateIncidentInputSchema,
  ReportSchema,
} from "./schemas.js";

describe("Core schemas — scaffold smoke tests", () => {
  it("TimelineEventSchema accepts a valid event", () => {
    const event = {
      id: "mock:evt-001",
      source: "mock",
      timestamp: "2024-10-31T10:00:00.000Z",
      kind: "alert",
      severity: "critical",
      entities: [{ type: "service", name: "payment-api" }],
      summary: "Payment service returned 500 errors",
      raw: { original: true },
    };
    expect(() => TimelineEventSchema.parse(event)).not.toThrow();
  });

  it("TimelineEventSchema rejects a summary that is too long", () => {
    const event = {
      id: "mock:evt-002",
      source: "mock",
      timestamp: "2024-10-31T10:00:00.000Z",
      kind: "alert",
      severity: "info",
      entities: [],
      summary: "x".repeat(201),
      raw: {},
    };
    expect(() => TimelineEventSchema.parse(event)).toThrow();
  });

  it("ClusterSchema accepts a valid cluster", () => {
    const cluster = {
      id: "cluster-1",
      eventIds: ["mock:evt-001", "mock:evt-002"],
      entities: [{ type: "service", name: "payment-api" }],
      start: "2024-10-31T10:00:00.000Z",
      end: "2024-10-31T10:05:00.000Z",
    };
    expect(() => ClusterSchema.parse(cluster)).not.toThrow();
  });

  it("TimelineSchema accepts a valid timeline", () => {
    const timeline = {
      events: [],
      clusters: [],
      suspectedTriggerId: "mock:evt-001",
    };
    expect(() => TimelineSchema.parse(timeline)).not.toThrow();
  });

  it("IncidentSchema accepts a valid incident", () => {
    const incident = {
      id: "inc-001",
      title: "Payment API outage",
      startAt: "2024-10-31T09:00:00.000Z",
      endAt: "2024-10-31T11:00:00.000Z",
      services: ["payment-api"],
      status: "pending",
      createdAt: "2024-10-31T09:05:00.000Z",
    };
    expect(() => IncidentSchema.parse(incident)).not.toThrow();
  });

  it("CreateIncidentInputSchema rejects when endAt is before startAt", () => {
    const input = {
      title: "Backwards incident",
      startAt: "2024-10-31T11:00:00.000Z",
      endAt: "2024-10-31T09:00:00.000Z",
      services: ["payment-api"],
    };
    const result = CreateIncidentInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("CreateIncidentInputSchema rejects when services array is empty", () => {
    const input = {
      title: "No services",
      startAt: "2024-10-31T09:00:00.000Z",
      endAt: "2024-10-31T11:00:00.000Z",
      services: [],
    };
    const result = CreateIncidentInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("ReportSchema accepts a valid report", () => {
    const report = {
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
    expect(() => ReportSchema.parse(report)).not.toThrow();
  });
});
