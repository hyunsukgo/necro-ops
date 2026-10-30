# Requirements Document — Necro-Ops MVP

## Introduction
Necro-Ops collects signals about a resolved incident from multiple sources (Datadog, Kubernetes, Terraform, Slack, or mock fixtures), normalizes and correlates them into a single timeline, and generates an evidence-backed, blameless postmortem. This spec covers the hackathon MVP.

## Requirements

### Requirement 1 — Incident creation
**User Story:** As an SRE, I want to register an incident with a time window and affected services, so that Necro-Ops knows what to investigate.

#### Acceptance Criteria
1. WHEN the user submits a title, start time, end time and at least one service name THEN the system SHALL create an incident with status `pending`.
2. IF the end time is earlier than the start time THEN the system SHALL reject the request with a validation message.
3. WHEN an incident is created THEN the system SHALL automatically extend the collection window by a configurable padding (default 30 minutes before start, 15 minutes after end).
4. WHEN the user opens the morgue page THEN the system SHALL list incidents sorted by start time, newest first, with their status.

### Requirement 2 — Exhume (multi-source collection)
**User Story:** As an SRE, I want Necro-Ops to pull evidence from all my tools at once, so that I don't have to search each tool manually.

#### Acceptance Criteria
1. WHEN the user triggers "Exhume" on an incident THEN the system SHALL query every enabled connector for the incident window in parallel.
2. WHILE collection is running THE system SHALL show per-connector progress (pending / running / done / failed / skipped).
3. IF a connector fails or times out (default 30 s) THEN the system SHALL record the error, mark that connector `failed`, and continue with the remaining connectors.
4. IF a connector has no credentials configured THEN the system SHALL mark it `skipped` without raising an error.
5. WHEN `NECRO_MODE=demo` THEN the system SHALL use only the mock connector.
6. Connectors SHALL perform read-only operations only.

### Requirement 3 — Normalization
**User Story:** As a developer, I want every source event converted to one common shape, so that correlation logic is source-agnostic.

#### Acceptance Criteria
1. WHEN a connector returns raw data THEN the system SHALL convert each item into a `TimelineEvent` with: id, source, timestamp (UTC), kind, severity, entities, summary, raw payload, and a deep link when available.
2. IF a raw item cannot be validated THEN the system SHALL drop it and log a warning including the source and reason.
3. WHEN the same event is reported twice by a source THEN the system SHALL de-duplicate it by source and source-native id.

### Requirement 4 — Stitch (correlation & timeline)
**User Story:** As an SRE, I want related events grouped together, so that I can see cause and effect instead of raw noise.

#### Acceptance Criteria
1. WHEN normalization completes THEN the system SHALL order all events chronologically into a single timeline.
2. THE system SHALL group events into clusters when they share at least one entity (service, namespace, pod, resource address) and occur within a configurable gap (default 5 minutes).
3. THE system SHALL flag the earliest change-type event (deploy, `terraform apply`, config change) preceding the first critical alert as a **suspected trigger**.
4. WHEN the user filters by source, severity or entity THEN the timeline SHALL update without re-collecting data.
5. The correlation functions SHALL be pure and deterministic for the same input.

### Requirement 5 — Autopsy report
**User Story:** As an SRE, I want a draft postmortem generated from the evidence, so that I only need to review and edit it.

#### Acceptance Criteria
1. WHEN the user triggers "Perform Autopsy" THEN the system SHALL generate a report with sections: Summary, Cause of Death (root cause), Contributing Factors, Timeline, Impact, Detection & Response, Action Items.
2. Every statement in Cause of Death and Contributing Factors SHALL cite at least one `TimelineEvent` id; the UI SHALL render citations as links to the event.
3. THE report SHALL use blameless language and SHALL NOT attribute fault to named individuals.
4. IF Bedrock is not configured or returns invalid output twice THEN the system SHALL produce a template-based report from the timeline and suspected trigger.
5. WHEN the report is generated THEN the user SHALL be able to edit any section and save the edited version.
6. THE system SHALL mark the report as AI-generated draft until a user saves it.

### Requirement 6 — Export
**User Story:** As an SRE, I want to export the report, so that I can put it into our wiki.

#### Acceptance Criteria
1. WHEN the user clicks Export THEN the system SHALL download the report as Markdown including the timeline table and citations.
2. THE exported Markdown SHALL NOT include raw payloads or any secret values.

### Requirement 7 — Demo scenarios
**User Story:** As a hackathon judge, I want to try the app without any credentials, so that I can evaluate it in minutes.

#### Acceptance Criteria
1. THE repository SHALL include at least 3 mock scenarios: (a) OOMKilled pods after a memory limit change via Terraform, (b) expired TLS certificate causing 5xx, (c) bad deploy rolled back after a Slack discussion.
2. WHEN the app starts in demo mode with an empty database THEN the system SHALL seed the scenarios automatically.
3. Each scenario SHALL contain events from at least 3 different sources so that stitching is visible.

### Requirement 8 — Haunted UI
**User Story:** As a user, I want a memorable, spooky interface that is still easy to read, so that the product stands out without hurting usability.

#### Acceptance Criteria
1. THE UI SHALL provide a dark "morgue" theme with source-specific icons and a timeline that visually "stitches" clusters together.
2. Text and background colors SHALL meet WCAG AA contrast.
3. Animations SHALL respect `prefers-reduced-motion`.
4. THE layout SHALL be usable at 1280 px and 390 px widths.

### Requirement 9 — Security & privacy
**User Story:** As a platform owner, I want the tool to be safe to point at production systems.

#### Acceptance Criteria
1. THE system SHALL read credentials only from environment variables and SHALL NOT persist them to the database or logs.
2. Before sending evidence to the LLM THE system SHALL redact values matching common secret patterns (API keys, tokens, passwords, emails).
3. THE system SHALL NOT call any write/mutating endpoint of external systems.
