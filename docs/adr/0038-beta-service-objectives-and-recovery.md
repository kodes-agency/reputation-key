---
status: proposed
---

# 0038 — Beta service objectives and recovery

Initial service-level objectives for the internal beta. These are operating objectives for the engineering team, not customer-facing SLAs. BETA-3 proves them against target-scale load and fault injection.

## Service objectives

| Signal                                  | Objective        | Measurement                            |
| --------------------------------------- | ---------------- | -------------------------------------- |
| Authenticated page/API availability     | ≥ 99.5% monthly  | Synthetic probe + uptime monitoring    |
| GBP notification → review committed     | p95 ≤ 60s        | Outbox relay lag under healthy deps    |
| Review committed → inbox visible        | p99 ≤ 30s        | Dispatcher throughput                  |
| Reply publish → terminal status visible | p95 ≤ 10s        | BullMQ job duration                    |
| Common property/inbox response          | p95 ≤ 750ms      | Server timing at pilot data volume     |
| Dashboard query (rollup)                | p95 ≤ 500ms warm | Query timing via rollup tables         |
| Data loss from committed source         | Zero             | Fault injection: no orphan outbox rows |
| Duplicate externally visible reply      | Zero             | Fault injection: receipt dedup proof   |

## Recovery objectives

| Objective            | Target       | Verification                                  |
| -------------------- | ------------ | --------------------------------------------- |
| RPO (recovery point) | ≤ 15 minutes | PITR backup interval + restore drill          |
| RTO (recovery time)  | ≤ 4 hours    | Full restore from backup to operational state |

## Alert severity

| Severity | Response                | Examples                                                           |
| -------- | ----------------------- | ------------------------------------------------------------------ |
| P0       | Immediate, page on-call | Data loss, tenant isolation breach, auth bypass, Google token leak |
| P1       | Same working day        | Reply publish failure, sync backlog > 1hr, dashboard unavailable   |
| P2       | Next working day        | Performance budget exceeded, notification delivery degraded        |
| P3       | Backlog                 | Non-critical feature degradation                                   |

Every alert links to a runbook with diagnostic steps, mitigation, escalation contacts, and rollback procedure.

## Beta stop conditions

Automatic stop (halt all external effects, preserve data):

1. Tenant isolation breach detected
2. Unauthorized Google action observed
3. Unexplained data loss from committed state
4. Duplicate externally visible reply/email
5. Leaked token or secret in logs/responses
6. Inability to restore from backup within RTO
7. Privacy/policy violation (raw content persists past TTL, cross-property AI, etc.)

Stop procedure: disable capabilities via `BETA_CAPABILITIES_OFF`, stop schedulers, preserve canonical data, drain or quarantine queues, follow the incident runbook.

## Exception process

Every deviation from these objectives requires a signed exception containing: reachability, mitigation, owner, expiry date, and upgrade/remediation issue. Exceptions auto-expire and require re-review.

## Considered options

- **Tighter objectives.** Rejected — beta scale (5K properties, 500K reviews/month) doesn't warrant stricter SLOs than the operating objectives above.
- **Looser objectives.** Rejected — a 15-minute RPO is achievable with standard PITR and is the maximum acceptable for review data.
