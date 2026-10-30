---
inclusion: always
---

# Repository Structure

```
necro-ops/
├─ apps/
│  └─ web/                    # Next.js app (UI + API route handlers)
│     ├─ app/
│     │  ├─ morgue/           # incident list ("the morgue")
│     │  ├─ incidents/[id]/   # autopsy table: timeline + evidence + report
│     │  └─ api/              # route handlers (exhume, autopsy, export)
│     └─ components/          # UI components (spooky theme lives here)
├─ packages/
│  ├─ core/                   # domain types, normalizer, correlator, timeline
│  ├─ connectors/             # datadog/, k8s/, terraform/, slack/, mock/
│  ├─ autopsy/                # report generation (Bedrock + template fallback)
│  │  └─ prompts/             # versioned prompt files
│  └─ db/                     # drizzle schema + migrations
├─ fixtures/
│  └─ scenarios/              # mock incidents (one folder per scenario)
├─ docs/                      # architecture diagram, demo script
└─ .kiro/                     # steering, specs, hooks
```

## Naming
- Files: kebab-case. Types/interfaces: PascalCase. Functions: camelCase.
- Themed names are allowed in UI copy and route names (morgue, exhume, autopsy) but domain code uses plain names (`Incident`, `TimelineEvent`, `Report`).

## Dependency direction
`apps/web` → `autopsy` → `core` ← `connectors`; `db` is used only by `apps/web`.
`core` must not import from any other package.
