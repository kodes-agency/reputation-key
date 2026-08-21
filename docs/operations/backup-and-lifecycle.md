# BQC-7.8 — Backup, Restore, and Lifecycle Configuration

**Date:** 2026-07-31
**Owner:** Bozhidar Denev
**Scope:** PostgreSQL PITR/backups, Redis durability, object lifecycle, log/trace
retention, data-retention registry, quarantine TTL, evidence retention, region/
encryption/access posture for internal beta.

Exit-matrix line: **"Backup/PITR and retention configuration is
documented/active."** BQC-8 (not this slice) performs the TIMED
restoration/recovery proof against the RPO/RTO targets.

Related: [runbooks.md](runbooks.md) §7/§8,
[bqr6-recovery-rehearsal.md](bqr6-recovery-rehearsal.md) (procedure + targets),
[ADR 0038](../adr/0038-beta-service-objectives-and-recovery.md) (RPO ≤ 15 min,
RTO ≤ 4 h), [ADR 0048](../adr/0048-property-region-routing.md) (single-cell posture).

---

## 1. PostgreSQL backups / PITR (Railway Postgres)

**Platform.** Production PostgreSQL is Railway Postgres (the web + worker +
migrate services attach to it). Older docs/scripts that say "Neon" are stale —
this document is the current reference.

**Configuration (platform console, owner: Bozhidar Denev).** Backups/PITR are a
platform feature, configured and verified in the Railway project console —
NOT in app code or railway.json (which deliberately carries no backup knobs):

- Railway project → Postgres service → **Backups** tab: backup schedule is
  enabled; the retention window and the available restore points are listed
  there. The restore point used in any drill/incident must be inside that
  window — confirm in the console BEFORE starting (this is also the
  `ops:restore-preflight` checklist reminder).
- **Where to verify:** the same Backups panel (schedule, last successful
  backup, window) at drill time and after any platform plan change.
- **Target:** PITR granularity must satisfy RPO ≤ 15 min (ADR 0038); BQC-8
  times the actual achieved RPO/RTO in the recovery rehearsal.

**PITR EXECUTION stays platform-owned** (registered finding — runbooks.md
"Registered gaps"): no app/ops command performs a point-in-time restore.
`ops:restore-preflight` is a guided checklist only; it is NOT an executor.

**Restore procedure (the only rollback path, reserved for data loss):**

1. `pnpm ops:restore-preflight --operator <id>` against the intended target —
   refuses anything but an isolated (loopback) target, verifies the migration
   journal is readable, prints the backup-window reminder.
2. PITR to an **isolated** Railway project/instance (platform console —
   platform owner). Never restore into a live or shared database.
3. Migration parity: run the deploy migration trio
   (`node dist-worker/migrate-deploy.js`, advisory-locked, idempotent) so the
   restored instance's schema matches the release SHA.
4. Boot **isolated**: set `RESTORE_MODE=isolated` on the restored
   environment. The worker REFUSES to boot in this mode (no schedules, no
   BullMQ consumers, no outbox relay, no external effects — by construction);
   the web process boots with every capability evaluation denying fail-closed
   (the beta-capabilities seam) so reads stay available for verification.
   Both processes log the loud line `RESTORE MODE ISOLATED — external effects
disabled`.
5. `pnpm ops:restore-verify --operator <id> --reason <text> --apply --yes
ops:restore-verify` — hard-requires `RESTORE_MODE=isolated` + an isolated
   target, runs both the source-policy purge and the receipt-first Google
   import lifecycle reconciliation IN-PROCESS (not BullMQ), writes normal
   `retention_runs` evidence (`reviews.purge` and
   `integration.google_import_v2.lifecycle`), asserts ZERO expired content,
   expired import items, purge-ready parents, and unreleased expired Property
   receipts remain, then prints the evidence + cutover checklist. A restored
   environment must never serve expired source content or resume orphaned
   import authority.
6. Cutover: verify reads, then **UNSET `RESTORE_MODE`** and redeploy web +
   worker; confirm the worker boots and schedules resume (runbooks §8).

**Local drill proof (this slice).** The isolated-boot + purge-verify half is
proven locally: worker boot refusal with the loud line, capability fail-closed
at the seam (unit suite), and `ops:restore-verify` green against a local
restored-shape database. The timed platform PITR execution is BQC-8's
rehearsal (bqr6-recovery-rehearsal.md).

## 2. Redis durability

**Posture: disposable-and-rebuild.** Redis holds BullMQ queues, rate-limit
state, the PKCE/state store, and alert/heartbeat keys — NO durable facts. The
Postgres outbox is the durable fact store: on Redis loss, events accumulate in
the outbox and the relay redrives the backlog when Redis returns (runbooks §7).
**No AOF/persistence is required for correctness** — enabling platform-side
Redis persistence is optional operational comfort, never a correctness
dependency.

BullMQ history prune is count-based (`removeOnComplete: 100`,
`removeOnFail: 50`, queue factory) plus the dead-letter lifecycle below.

**Quarantine TTL (this slice).** The failure-quarantine queue is the dead
letter — no consumer by design. The new daily `quarantine-ttl-sweep` job
(scheduled on the background queue, offset 4h) removes quarantined entries
older than `QUARANTINE_TTL_DAYS` (default **30 days**) via per-entry
`job.remove()` — NEVER obliterate/clean (containment constraint). Locked
entries (operator redrive in flight) are skipped, not forced. Every run
writes a `retention_runs` evidence row (subject `quarantine.ttl`); a failed
run trips the `retention.failure` alert. The 24h
`queue.quarantine-growth` alert (operator redrive SLA) is unchanged and
orthogonal: the SLA asks operators to drain; the TTL is the last-resort bound.

## 3. Object lifecycle (S3)

Portal image uploads are gated by `portal.upload`, a **non-core** capability
(ADR 0032) — off until an organization and its properties are allowlisted, not
permanently blocked; only the three `gbp.*` prohibitions are. The S3 adapter is
additionally a no-op while the four `AWS_S3_*` vars are unconfigured, so an
allowlisted tenant still uploads nothing until the bucket is configured. Once
both are in place, bucket lifecycle rules are platform (S3) configuration —
expected shape: expire portal image objects per the source-content policy
horizon (raw content 30d, §5), documented here as the configuration expectation
to be applied at enablement.

## 4. Log / trace retention

- App logs: pino JSON to stdout (web + worker) → **Railway log retention**
  (platform setting — the retention window is whatever the Railway project/
  plan provides; verify in the Railway console under the service's
  Observability/Logs settings; owner: Bozhidar Denev). No app-side log
  shipping exists.
- Traces: no OTEL exporter is configured — `trace()` spans are structured
  log lines, so trace retention equals log retention.
- Content posture: the BQC-7.3 log schema + canary/redaction checks apply
  (no protected content in logs/metrics/evidence); alert dispatch is an
  error-level schema-conformant log line + optional `ALERT_WEBHOOK_URL` POST.

## 5. Data-retention registry (RETENTION_POLICY_VERSION 2)

Evidence for every deletion lands in `retention_runs` (content-free:
subject, counts, outcome, policy version). Scheduled sweeps run on the
background queue (purge daily offset 2h, retention-sweep offset 3h,
quarantine-ttl-sweep offset 4h).

| Subject                                  | Table / store                                      | TTL / trigger                                                                                                                                                                       | Mechanism                                                                                 |
| ---------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `reviews.purge`                          | `reviews` (expired)                                | Source policy: raw content 30d from last fetch (refresh-due 25d) — ADR 0031, no grace                                                                                               | daily purge job (in-transaction delete + `review.expired` fact)                           |
| `reviews.purge.connection`               | `reviews` by connection                            | on disconnect (event-driven)                                                                                                                                                        | source-content purge (bounded executor)                                                   |
| `reviews.purge.property`                 | `reviews` by property                              | on approved property purge                                                                                                                                                          | source-content purge                                                                      |
| `reviews.purge.organization`             | `reviews` by org                                   | on approved org purge                                                                                                                                                               | source-content purge                                                                      |
| `inbox_items.purge.property`             | `inbox_items` by property                          | companion of property purge                                                                                                                                                         | source-content purge                                                                      |
| `integration.google_import_v2.lifecycle` | import parents/items + Property operation receipts | item `effect_deadline_at`; parent fixed `purge_at` at first terminal + 30d; Property receipt fixed 32d and retention release                                                        | receipt-first terminalization, bounded parent purge/release event, released receipt sweep |
| `outbox_events.published`                | `outbox_events`                                    | 30d from `published_at`                                                                                                                                                             | retention-sweep                                                                           |
| `event_consumer_receipts`                | `event_consumer_receipts`                          | 30d                                                                                                                                                                                 | retention-sweep                                                                           |
| `review_sync_runs`                       | `review_sync_runs`                                 | 30d                                                                                                                                                                                 | retention-sweep                                                                           |
| `review_refresh_runs`                    | `review_refresh_runs`                              | 30d                                                                                                                                                                                 | retention-sweep                                                                           |
| `inbound_webhook_receipts`               | `inbound_webhook_receipts`                         | 30d                                                                                                                                                                                 | retention-sweep                                                                           |
| `notifications`                          | `notifications`                                    | 90d                                                                                                                                                                                 | retention-sweep                                                                           |
| `notification_email_queue`               | `notification_email_queue`                         | 90d, terminal states only                                                                                                                                                           | retention-sweep                                                                           |
| `activity_log`                           | `activity_log`                                     | 90d                                                                                                                                                                                 | retention-sweep                                                                           |
| `gbp_cache`                              | `gbp_cache`                                        | at `expires_at`                                                                                                                                                                     | retention-sweep                                                                           |
| `policy_decision_audit`                  | `policy_decision_audit`                            | **365d** (beta audit-trail horizon, BQC-7.8)                                                                                                                                        | retention-sweep                                                                           |
| `audit_logs`                             | `audit_logs`                                       | **365d** (same horizon, BQC-7.8)                                                                                                                                                    | retention-sweep                                                                           |
| `quarantine.ttl`                         | `quarantine` BullMQ queue                          | `QUARANTINE_TTL_DAYS` (default 30d)                                                                                                                                                 | quarantine-ttl-sweep                                                                      |
| `retention_runs`                         | `retention_runs`                                   | **indefinite-by-design** — the evidence chain FOR deletions; deleting it would erase the proof of erasure. Size monitored via the metrics snapshot; no rule exists by deliberation. | none (monitored)                                                                          |

Version history: v1 (BQC-1.6) initial 9-rule registry + lifecycle purges; v2
(BQC-7.8) + `policy_decision_audit` / `audit_logs` at 365d, +
`quarantine.ttl`, Google import lifecycle evidence, and `retention_runs`
documented indefinite-by-design.

## 6. Evidence retention

- **Deletion evidence** (`retention_runs`) and **decision audit**
  (`policy_decision_audit`) / **action audit** (`audit_logs`): per the registry
  above — audit tables at the 365d horizon, `retention_runs` indefinite.
- **CI artifacts** (GitHub Actions): SBOM (`sbom-spdx`) 30d, container image
  SBOMs (`sbom-images-spdx`) 30d, e2e failure artifacts 7d
  (`.github/workflows/ci.yml`).
- **Release evidence**: `docs/release-evidence/beta/` is git-retained
  (permanent, reviewable history).
- **Operational Redis keys**: alert firing-state 24h TTL (re-notify window),
  worker heartbeat 900s TTL (one missed 5-min beat tolerated).

## 7. Region placement, encryption, access

- **Region:** single-cell **US** beta posture — `PROCESSING_CELL=us` is the
  only approved cell (ADR 0048); a worker declaring another cell quarantines
  routed jobs (fail closed). The deployment region is the Railway project
  region (platform console setting — web/worker/Postgres/Redis services in
  one project; no cross-region failover by policy, runbooks §12).
- **Encryption at rest:** platform-managed — Railway Postgres storage and
  service volumes are encrypted by the platform; OAuth tokens are
  additionally AES-256-GCM encrypted at the application layer
  (`ENCRYPTION_KEY`).
- **Encryption in transit:** TLS — `DATABASE_URL` with `sslmode=require`,
  Redis over TLS where the provider endpoint requires it, HTTPS at the
  platform edge (HSTS in production).
- **Access:** the Railway project (console + env vars + backups + logs) is
  owned by the platform owner (Bozhidar Denev); no shared third-party access.
- **Secrets:** stored as Railway service variables, **distinct per
  environment** (production / staging / test identities are separate — the
  BQC-7.6 placeholder-secret boot guard refuses known test values in
  production). `OPS_OPERATOR_IDENTITIES` gates operator commands per
  environment.
