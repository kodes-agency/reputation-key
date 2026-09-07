---
status: accepted
date: 2026-07-15
---

# 0038 — Beta recovery objectives and stop conditions

These are internal engineering objectives, never a customer SLA. They become
operational when a production database exists and are verified by provider
backup state plus a timed restore drill.

## Recovery objectives

| Objective | Target       | Verification                                  |
| --------- | ------------ | --------------------------------------------- |
| RPO       | ≤ 15 minutes | PITR backup interval plus restore drill       |
| RTO       | ≤ 4 hours    | Full restore from backup to operational state |

## Beta stop conditions

Any one condition stops all external effects while preserving canonical data:

1. Tenant isolation breach detected.
2. Unauthorized Google action observed.
3. Unexplained data loss from committed state.
4. Duplicate externally visible reply or email.
5. Leaked token or secret in logs or responses.
6. Inability to restore from backup within the RTO.
7. Privacy or policy violation, including content retained past its deadline or
   prohibited cross-Property AI processing.

Set `BETA_CAPABILITIES_OFF`, stop schedulers, preserve canonical data, and drain
or quarantine queued work. Recovery follows the incident runbook; no capability
is restored before the violated boundary is reconciled and verified.

## Consequences

- Repository tests can prove the stop mechanism, not a live backup or restore.
- RPO and RTO evidence records the exact release, migration head, source,
  target, elapsed time, and operator decision without tenant content.
- Availability, latency, severity taxonomy, and exception ceremonies are
  operating details rather than architectural decisions.
