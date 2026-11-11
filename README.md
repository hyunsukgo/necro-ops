# ☠ Necro-Ops — The Incident Morgue

> Perform an **autopsy** on dead (resolved) production incidents. Necro-Ops stitches
> together signals from monitoring, Kubernetes, infrastructure-as-code, and team chat
> into one correlated timeline, then writes a blameless postmortem automatically.

Built for **Kiroween 2026** · Category: **Frankenstein** (stitching incompatible tools into one app)

---

## Why

After an incident, the evidence is scattered: alerts in Datadog, pod events in
Kubernetes, the recent `terraform apply` in CI logs, and the human conversation in
Slack. Reconstructing "what happened when" takes hours — and is often skipped.

Necro-Ops does it in three moves:

1. **Exhume** — pull every signal for an incident window from each source, in parallel.
2. **Stitch** — normalize and correlate them into one chronological timeline, cluster
   related events, and flag the **suspected trigger** (e.g. the deploy 8 minutes before
   the first page).
3. **Autopsy** — generate an evidence-backed, blameless postmortem: cause of death,
   contributing factors, timeline, impact, detection & response, and action items.

Every statement in the report links back to the actual event that supports it.

---

## Quickstart (demo mode — no credentials needed)

Judges can run the full experience with **zero configuration**. Three realistic mock
scenarios are auto-seeded into a local SQLite file on first launch.

```bash
# 1. Install dependencies (requires Node 22+ and pnpm 9+)
pnpm install

# 2. Start the app in demo mode
pnpm dev

# 3. Open the Morgue
open http://localhost:3000/morgue
```

That's it. The three seeded incidents are ready to exhume and autopsy:

| Scenario | What happened |
|---|---|
| **OOMKilled** | A Terraform change scaled replicas without raising the memory limit → pods OOMKill |
| **Expired TLS cert** | A certificate expired on schedule → 5xx storm, no change event (tests the "no trigger" path) |
| **Bad deploy + rollback** | A null-check bug shipped in v2.5.0 → NPE spike → Slack discussion → rollback |

### Try the flow

1. Open an incident from the Morgue.
2. Click **Exhume** — watch per-connector progress stream in live (SSE).
3. See the **stitched timeline** with the ⚡ suspected-trigger badge; filter by source / severity.
4. Click **Perform Autopsy** — a report is generated (template generator in demo mode).
5. Citations in the report are clickable — they scroll to the cited event.
6. Click **Export .md** to download the postmortem as Markdown.

---

## Architecture

```
┌──────────────┐     POST /api/incidents            ┌───────────────────┐
│  Next.js UI  │ ─────────────────────────────────▶ │  Route handlers   │
│  (morgue,    │ ◀───── SSE progress stream ──────── │  (exhume, autopsy,│
│   autopsy)   │                                     │   export)         │
└──────────────┘                                     └─────────┬─────────┘
                                                               │
                          ┌────────────────────────────────────┤
                          ▼                                    ▼
                 ┌──────────────────┐                 ┌─────────────────┐
                 │ Exhume           │                 │   SQLite (via   │
                 │ orchestrator     │                 │   Drizzle ORM)  │
                 │ (Promise.all-    │                 └─────────────────┘
                 │  Settled +       │
                 │  per-connector   │   ┌───────── connectors (read-only) ─────────┐
                 │  timeout)        │──▶│ datadog · k8s · terraform · slack · mock  │
                 └────────┬─────────┘   └───────────────────────────────────────────┘
                          │  raw items
                          ▼
                 ┌──────────────────┐   normalize → dedupe → buildTimeline
                 │  core (pure fns) │   → findSuspectedTrigger
                 └────────┬─────────┘
                          │  Timeline
                          ▼
                 ┌──────────────────┐   Bedrock (Claude) with citation check,
                 │  autopsy         │   retry once, then deterministic template
                 └──────────────────┘   fallback
```

### Monorepo layout

```
necro-ops/
├─ apps/web/            # Next.js app (UI + API route handlers) + Playwright e2e
├─ packages/
│  ├─ core/             # domain types, redact, dedupe, buildTimeline, findSuspectedTrigger (pure)
│  ├─ connectors/       # shared Connector interface + mock connector
│  ├─ autopsy/          # templateReport + Bedrock generate() (prompts/ versioned)
│  └─ db/               # Drizzle schema, migrations, queries, demo seed
├─ fixtures/scenarios/  # the three mock incidents
└─ .kiro/               # Kiro steering, specs, hooks
```

**Dependency direction:** `apps/web → autopsy → core ← connectors`; `db` is used only by `apps/web`. `core` imports from no other package and is fully deterministic.

---

## Tech stack

- **TypeScript** (strict) everywhere, Node 22, **pnpm** workspaces
- **Next.js** App Router + React Server Components, **Tailwind CSS**
- **zod** at every external boundary
- **SQLite** via **Drizzle ORM** (single file — zero ops for judges)
- **Amazon Bedrock** (Anthropic Claude) for the narrative, with a deterministic
  template fallback when Bedrock isn't configured
- **Vitest** (unit) + **Playwright** (one end-to-end demo flow)

---

## Going live (optional)

Copy `.env.example` to `.env` and fill in credentials. Each connector enables itself
only when its env vars are present; everything else stays mocked.

```bash
NECRO_MODE=live          # demo (default) uses only the mock connector
DATADOG_API_KEY=...      # Datadog events + monitors
KUBECONFIG=...           # Kubernetes events + pod status
TERRAFORM_STATE_DIR=...  # terraform show -json + CI apply logs
SLACK_BOT_TOKEN=...       # Slack channel history (redacted, no names)
AWS_ACCESS_KEY_ID=...     # Amazon Bedrock for the LLM narrative
```

All connectors are **read-only** — Necro-Ops never writes to or mutates external systems.

### Security & privacy

- Credentials are read only from environment variables; never persisted or logged.
- Evidence is **redacted** (API keys, tokens, passwords, emails, JWTs) before it ever
  reaches the LLM.
- Raw payloads are stored but **never** included in the exported Markdown.

---

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Run the web app in demo mode |
| `pnpm test` | Unit tests (Vitest) — 345 tests across core, connectors, autopsy, db, web |
| `pnpm --filter web exec playwright test` | End-to-end demo flow (Playwright) |
| `pnpm --filter web seed` | Load the mock scenarios into SQLite manually |
| `pnpm build` | Production build of the web app |
| `pnpm lint` | ESLint |

---

## How Kiro was used

This project was built spec-first with Kiro:

- **Specs** (`.kiro/specs/necro-ops-mvp/`) — `requirements.md` (EARS acceptance
  criteria), `design.md` (architecture, interfaces, data model), and `tasks.md` (a
  numbered implementation plan). Each task references the requirement IDs it satisfies,
  and every task was implemented and checked off in order.
- **Steering** (`.kiro/steering/`) — always-on context for the agent: `product.md`
  (vision, scope, principles), `tech.md` (stack, conventions, the read-only connector
  rule, "LLM output must be zod-parsed, retry once, then fall back to template"), and
  `structure.md` (repo layout and dependency direction). These kept generated code
  consistent with the intended architecture across every task.
- **Determinism as a design constraint** — correlation (`buildTimeline`,
  `findSuspectedTrigger`) and the template report are pure functions, locked in with
  **golden tests** so the demo is reproducible.

---

## License

MIT (hackathon submission).
