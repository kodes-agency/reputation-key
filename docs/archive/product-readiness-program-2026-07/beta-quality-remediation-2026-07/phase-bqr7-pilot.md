# BQR-7 — Staged real-property pilot and acceptance

**Status:** Not started — **human-gated**  
**Depends on:** BQR-0…BQR-6 evidence for one immutable release candidate  
**Estimate:** 14-day observation + 3–5 engineering days

## Outcome

One owned **US** property completes read-only shadow then controlled **manual** reply. Then 3–5 allowlisted US properties operate ≥ 14 stable observed days. Engineering, product, security/privacy, Google-project, and ops sign the same evidence manifest.

## Hard rules (do not skip)

1. No real Google review content enters an environment that failed BQR-3 source lifecycle + region gates.
2. `OUTBOX_DISPATCHER_ENABLED` remains off until an explicit, ticketed enablement for the pilot environment.
3. Synthetic data only until BQR-6 exit is signed (or exceptions approved).
4. Agent must **not** connect real properties without human pilot owner approval.

## Pilot stages

| Stage | Activity                                                      | Exit                            |
| ----- | ------------------------------------------------------------- | ------------------------------- |
| P0    | Freeze release candidate SHA + evidence pack                  | Manifest complete               |
| P1    | Single property read-only shadow (import/sync, no auto-reply) | Freshness + no policy violation |
| P2    | Controlled **manual** reply publish on that property          | Reply path audited              |
| P3    | Expand to 3–5 allowlisted US properties                       | 14-day stable observation       |
| P4    | Sign-off                                                      | All owners on `approval.md`     |

## Evidence

```text
docs/release-evidence/beta/<release-id>/
  pilot-observations.md
  approval.md
```

## Human inputs required

- Real GBP property / merchant authorization
- Operator enablement of any non-core capability
- Staging/prod deploy access for the pilot environment
- Signatures on the evidence pack

## Agent stance

Autonomous work stops at preparing checklists, tooling, and evidence scaffolds. **Do not** start P1–P4 without explicit human instruction naming the property and environment.
