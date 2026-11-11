# Building Necro-Ops: an autopsy table for dead production incidents

*Submitted to Kiroween 2026 · Frankenstein category*

## The idea

Every on-call engineer knows the ritual. Production breaks. You scramble. It recovers.
And then comes the part nobody enjoys: the postmortem. The evidence is scattered —
alerts in Datadog, pod events in Kubernetes, the `terraform apply` buried in CI logs,
and the real story in a Slack thread. Reconstructing "what happened when" takes hours,
so it often gets skipped or done badly.

The Frankenstein category asks you to stitch incompatible tools into one app. Incident
postmortems are *exactly* that problem: four tools that don't talk to each other, and a
human left to sew them together by hand. So we built **Necro-Ops** — an app that
performs an **autopsy** on dead incidents. It exhumes the evidence, stitches it into one
timeline, and writes a blameless postmortem automatically.

## The three moves

**Exhume.** Given an incident window, Necro-Ops queries every connected source in
parallel. Connectors are read-only and isolated — if Datadog times out, Kubernetes and
the others still finish. Progress streams to the UI over Server-Sent Events, so you
watch each source report in live.

**Stitch.** Each source speaks a different dialect, so everything is normalized into one
common `TimelineEvent` shape. Then a union-find pass clusters events that share an entity
(a service, pod, or resource) and happen close together in time. The result is a single
chronological timeline instead of four tabs of noise. A small heuristic flags the
**suspected trigger** — the latest change event (a deploy or `terraform apply`) before
the first critical alert that shares an entity with it. If no change shares an entity,
it falls back to the latest change before the alert; if there is no change at all (the
expired-certificate scenario), no trigger is flagged.

**Autopsy.** With the timeline in hand, Necro-Ops writes a blameless postmortem: cause
of death, contributing factors, impact, detection & response, and action items. Every
claim cites the event that supports it, and the citations are clickable — they scroll
you straight to the evidence.

## The engineering decisions we're proud of

**Determinism where it matters.** The correlation logic (`buildTimeline`,
`findSuspectedTrigger`) and the template report generator are pure functions. We locked
their behaviour in with *golden tests*: each mock scenario asserts an exact cluster count
and an exact suspected-trigger id. That means the demo is reproducible every single time
— no flaky "the AI felt different today."

**The LLM is on a leash.** When Amazon Bedrock is configured, Claude writes the
narrative — but we never trust it blindly. The output is parsed with zod, and every
citation id is checked against the real timeline. If the model hallucinates an event id
or returns malformed JSON, we retry once, and if that fails we fall back to a
deterministic template report. The app is fully usable with no credentials at all.

**Secrets never leak.** Evidence is redacted (API keys, tokens, passwords, emails, JWTs)
before it reaches the LLM. Raw payloads are stored but stripped from the exported
Markdown. And nothing Necro-Ops does ever mutates an external system — all connectors are
read-only.

**Zero-ops for judges.** Storage is a single SQLite file via Drizzle. In demo mode, three
realistic scenarios — an OOMKill after a Terraform memory change, an expired TLS
certificate, and a bad deploy that got rolled back after a Slack discussion — are
auto-seeded on first launch. `pnpm install && pnpm dev` and you're autopsying.

## How Kiro shaped the build

We built this spec-first. The Kiro spec (`requirements.md`, `design.md`, `tasks.md`) gave
us EARS-style acceptance criteria, an architecture with explicit interfaces, and a
numbered task list where every task cites the requirements it satisfies. We implemented
and checked off the tasks one at a time, running the test suite after each one.

To make "one task at a time" literal, we added a custom Kiro agent,
`.kiro/agents/necro-builder.json`. It is scoped to the steering files and the spec, and
told to do exactly one task per session: read the requirements and design, implement
only that task, write and run tests, then tick the box. A small wrapper,
`scripts/kiro-task.sh`, runs one task headless through Kiro CLI. It refuses to start on
a dirty tree, logs the run, and commits only if the task was actually checked off. So
the history reads like the plan: one scoped, tested commit per task.

Steering files kept the agent honest across the whole build: the product vision and
scope, the tech conventions (strict TypeScript, zod at every boundary, "LLM output must
be zod-parsed, retry once, then fall back to template"), and the repository structure
with its dependency direction (`core` imports from nobody). Because that guidance was
always in context, the generated code stayed consistent with the intended architecture
instead of drifting task to task.

## What's next

The real Datadog, Kubernetes, Terraform, and Slack connectors already sit behind the
same interface as the mock. Each turns on only when its credentials are present, is
read-only, and is tested against provider-shaped fixtures. The Slack one replaces user
mentions and user ids with a neutral "teammate" token and redacts emails and tokens. The correlation and autopsy layers didn't change at
all to support them; they only ever see the common event shape. Next: richer clustering
heuristics, and a diff view across related incidents.

## Try it

```bash
pnpm install
pnpm dev
open http://localhost:3000/morgue
```

Give your dead incidents the autopsy they deserve. ☠
