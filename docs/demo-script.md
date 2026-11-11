# Necro-Ops — Demo Video Script (≤ 3 minutes)

Target length: **2:45**. Record at 1280×720 or larger. Demo mode only — no credentials.
Keep the cursor slow and deliberate; let the spooky UI breathe.

---

## 0:00 – 0:20 — Hook & problem (talking head or voiceover over the Morgue)

> "When production breaks and then recovers, the hardest part isn't the fix — it's the
> postmortem. The evidence is scattered across Datadog, Kubernetes, Terraform, and
> Slack, and nobody wants to spend an afternoon stitching it back together."

On screen: the **Morgue** page (`/morgue`), three tombstone cards visible.

> "Necro-Ops performs an autopsy on your dead incidents — automatically."

---

## 0:20 – 0:45 — The Morgue (show, don't tell)

- Slowly pan over the three seeded scenarios.
- Hover the **OOMKilled** tombstone; point out status chip and services.

> "Everything you'll see runs in demo mode — no credentials, three realistic
> incidents seeded for you. Let's autopsy the OOMKill."

Click the **OOMKilled** incident.

---

## 0:45 – 1:20 — Exhume (the Frankenstein moment)

On the autopsy page, click **Exhume**.

> "Exhume pulls every signal for the incident window from each source in parallel.
> Watch the connectors report in live."

- Point at the per-connector chips (SSE stream). In demo mode the **mock** chip goes
  `running → done` with its event count, and **datadog · k8s · terraform · slack** show
  `skipped` because no credentials are set.

> "In demo mode the mock connector replays Datadog, Kubernetes, Terraform and Slack
> evidence. The real connectors are right there too — skipped, because there are no
> credentials, and the run carries on. Each source speaks a different language.
> Necro-Ops normalizes them all into one common event shape — this is the Frankenstein
> stitch."

---

## 1:20 – 1:55 — Stitched timeline + suspected trigger

Scroll to the **Stitched Timeline**.

> "Here's the whole incident as a single timeline. Related events are grouped into
> clusters, and the one event most likely to have caused it all is flagged
> automatically."

- Point to the ⚡ **suspected trigger** badge on the Terraform change.
- Use the **source** and **severity** filters to show it updating instantly.

> "The trigger here is the Terraform apply on `payments-worker`: it doubled the
> replicas but left the memory limit at 256 MiB — about fifteen minutes before the
> first OOMKill, and it shares a service with the first critical alert."

---

## 1:55 – 2:30 — Autopsy report

Click **Perform Autopsy**.

> "Now the autopsy. Necro-Ops writes a blameless postmortem — cause of death,
> contributing factors, impact, detection and response, and action items."

- Highlight the **Cause of Death** section.
- Click a **citation chip** → the page scrolls to the exact source event.

> "Every claim is evidence-backed. Click any citation and it jumps you straight to the
> event that proves it. No credentials? It uses a deterministic template. With Bedrock
> configured, Claude writes the narrative — and we still verify every citation exists."

---

## 2:30 – 2:45 — Export & close

Click **Export .md**.

> "Export to Markdown — timeline table and citations included, raw payloads and secrets
> stripped out — and paste it straight into your wiki."

On screen: the downloaded Markdown opened in an editor, "Cause of Death" visible.

> "Necro-Ops. Give your dead incidents the autopsy they deserve."

Fade to the ☠ logo.

---

## Shot list / b-roll checklist

- [ ] Morgue page with 3 tombstones
- [ ] Exhume connector chips: mock running → done, four real connectors skipped
- [ ] Timeline with ⚡ trigger badge
- [ ] Filter dropdowns changing the timeline
- [ ] Citation click → scroll-to-event highlight
- [ ] Exported `.md` file contents

## Recording tips

- Pre-seed by running `pnpm dev` once before recording so first-paint is instant.
- If a connector finishes too fast to see, narrate over it — do not slow the app down.
- Respect reduced-motion: the UI already honours `prefers-reduced-motion`; record with
  default motion on for visual punch.
