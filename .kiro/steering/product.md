---
inclusion: always
---

# Product: Necro-Ops — The Incident Morgue

## One-liner
Necro-Ops performs an "autopsy" on dead (resolved) production incidents: it stitches together signals from monitoring, Kubernetes, infrastructure-as-code and team chat into a single correlated timeline, then writes a blameless postmortem ("autopsy report") automatically.

## Hackathon context
- Event: Kiroween 2026 (Devpost). Primary category: **Frankenstein** (stitching incompatible tools into one app). Secondary: Costume Contest (spooky, polished UI).
- Deadline: 2026-12-04 14:00 PT. Scope must stay achievable by one person in ~5 weeks.
- Judges must be able to run the demo **without any real credentials** → mock scenarios are first-class, not an afterthought.

## Target users
- SRE / DevOps / platform engineers who must write postmortems after incidents.
- Engineering managers who want consistent, blameless incident write-ups.

## Core problem
After an incident, evidence is scattered: alerts in Datadog, pod events in Kubernetes, the recent `terraform apply` in state/CI logs, and the human conversation in Slack. Reconstructing "what happened when" takes hours and is often skipped.

## Core value
1. **Exhume** — pull every signal for an incident window from many sources.
2. **Stitch** — normalize and correlate them into one timeline (the "Frankenstein" part).
3. **Autopsy** — generate a blameless postmortem: cause of death, contributing factors, timeline, impact, action items.

## Product principles
- Blameless language only; never name individuals as causes.
- Every claim in the report must link back to at least one source event (evidence-backed).
- Works offline with mock data; real connectors are optional and read-only.
- Spooky theme is a skin, never at the cost of readability or accessibility.

## Out of scope (for the hackathon)
- Real-time alerting or paging.
- Write actions against any external system (no remediation, no posting to Slack).
- Multi-tenant auth / RBAC.
