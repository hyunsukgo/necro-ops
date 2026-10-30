# Implementation Plan — Necro-Ops MVP

- [x] 1. Scaffold monorepo
  - pnpm workspace, `apps/web` (Next.js + Tailwind), `packages/{core,connectors,autopsy,db}`, shared tsconfig (strict), ESLint/Prettier, Vitest, `.env.example`
  - _Requirements: 9.1_

- [x] 2. Core domain
  - [x] 2.1 Define `TimelineEvent`, `Entity`, `Cluster`, `Timeline` types and zod schemas
    - _Requirements: 3.1_
  - [x] 2.2 Implement `redact()` with unit tests for AWS keys, bearer tokens, passwords, emails, JWTs
    - _Requirements: 9.2_
  - [x] 2.3 Implement `dedupe()` with tests
    - _Requirements: 3.3_
  - [x] 2.4 Implement `buildTimeline()` (sort + union-find clustering) with tests
    - _Requirements: 4.1, 4.2, 4.5_
  - [x] 2.5 Implement `findSuspectedTrigger()` with tests
    - _Requirements: 4.3_

- [ ] 3. Mock scenarios and mock connector
  - [ ] 3.1 Create fixtures for scenarios (a) OOMKilled after Terraform memory change, (b) expired TLS cert, (c) bad deploy + Slack rollback discussion — each with ≥3 sources
    - _Requirements: 7.1, 7.3_
  - [ ] 3.2 Implement mock `Connector` + normalizer
    - _Requirements: 2.5, 3.1_
  - [ ] 3.3 Golden tests: scenario → expected suspected trigger and cluster count
    - _Requirements: 4.3, 7.1_

- [ ] 4. Database
  - [ ] 4.1 Drizzle schema + migrations for incidents, connector_runs, events, timelines, reports
  - [ ] 4.2 Auto-seed scenarios in demo mode when DB is empty
    - _Requirements: 7.2_

- [ ] 5. Exhume orchestrator & API
  - [ ] 5.1 `POST /api/incidents` with zod validation and window padding
    - _Requirements: 1.1, 1.2, 1.3_
  - [ ] 5.2 Orchestrator: parallel `allSettled`, per-connector timeout, skipped/failed states, persist events + timeline
    - _Requirements: 2.1, 2.3, 2.4, 2.6_
  - [ ] 5.3 SSE progress stream
    - _Requirements: 2.2_

- [ ] 6. Real connectors (read-only)
  - [ ] 6.1 Datadog: events + monitors in window, normalizer, fixture-based tests
  - [ ] 6.2 Kubernetes: events + pod status for namespaces/services, normalizer, tests
  - [ ] 6.3 Terraform: parse `terraform show -json` + CI apply log upload, normalizer, tests
  - [ ] 6.4 Slack: channel history in window, normalizer (redacted, no user names in summary), tests
  - _Requirements: 2.1, 2.4, 2.6, 3.1, 3.2, 5.3, 9.3_

- [ ] 7. Autopsy
  - [ ] 7.1 `templateReport(timeline)` deterministic generator
    - _Requirements: 5.1, 5.4_
  - [ ] 7.2 Prompt file + Bedrock client + zod parsing + citation-existence check + retry/fallback
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 9.2_
  - [ ] 7.3 Report API: generate, save edits (draft flag), Markdown export without raw payloads
    - _Requirements: 5.5, 5.6, 6.1, 6.2_

- [ ] 8. Haunted UI
  - [ ] 8.1 Theme tokens (AA contrast verified), reduced-motion handling, responsive layout
    - _Requirements: 8.2, 8.3, 8.4_
  - [ ] 8.2 Morgue page: tombstone list + new incident form
    - _Requirements: 1.4_
  - [ ] 8.3 Autopsy table: exhume panel, stitched timeline with filters and trigger badge
    - _Requirements: 2.2, 4.4, 8.1_
  - [ ] 8.4 Report view: citations as links, edit mode, export button
    - _Requirements: 5.2, 5.5, 6.1_

- [ ] 9. End-to-end & submission assets
  - [ ] 9.1 Playwright demo flow (scenario a → exhume → autopsy → export)
  - [ ] 9.2 README (demo-mode quickstart, architecture diagram, how Kiro was used: specs, steering, hooks)
  - [ ] 9.3 Demo video script (≤3 min) and blog post draft
