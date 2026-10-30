---
inclusion: always
---

# Tech Stack & Conventions

## Stack
- Language: **TypeScript** (strict mode) everywhere. Node.js 22 LTS.
- Monorepo: **pnpm workspaces**.
- Web: **Next.js (App Router)** + React Server Components, Tailwind CSS.
- Validation: **zod** for every external payload and every API boundary.
- Storage: **SQLite** via **Drizzle ORM** (single file, zero-ops for judges).
- LLM: **Amazon Bedrock** (Anthropic Claude) via `@aws-sdk/client-bedrock-runtime`.
  - Fallback: deterministic template-based report when Bedrock is not configured.
- Testing: **Vitest** (unit), **Playwright** (one end-to-end demo flow).
- Lint/format: ESLint + Prettier.

## Connectors (all read-only)
| Source | Library / API | Notes |
|---|---|---|
| Datadog | `@datadog/datadog-api-client` (events, monitors, logs search) | API + App key via env |
| Kubernetes | `@kubernetes/client-node` (events, pod status) | uses local kubeconfig |
| Terraform | parse `terraform show -json` plan/state files + CI run logs | file upload or path |
| Slack | `@slack/web-api` `conversations.history` | bot token, single channel |
| Mock | JSON fixtures under `fixtures/scenarios/` | default in demo mode |

## Configuration
- All secrets via environment variables; provide `.env.example`. Never commit secrets.
- `NECRO_MODE=demo|live` — `demo` (default) uses mock connectors only.
- Each connector is enabled only when its env vars are present.

## Coding rules
- Connectors implement one shared `Connector` interface (see design.md); no connector-specific logic outside its package.
- Pure functions for correlation and timeline building — easy to unit test.
- No `any`. Prefer discriminated unions for event kinds.
- Times are stored and compared as UTC ISO-8601; render in the viewer's timezone.
- LLM prompts live in versioned files under `packages/autopsy/prompts/`, not inline strings.
- LLM output must be parsed with zod; on parse failure, retry once, then fall back to the template.

## Commands
- `pnpm dev` — run web app in demo mode
- `pnpm test` — unit tests
- `pnpm e2e` — Playwright demo flow
- `pnpm seed` — load mock scenarios into SQLite
