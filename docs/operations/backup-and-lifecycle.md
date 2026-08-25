# Backup, recovery fencing, and lifecycle configuration

**Date:** 2026-08-25
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

Railway PITR does **not** create a separate project. It creates a new sibling
Postgres service named `<source>-restored-YYYYMMDD-HHMM` in the source
environment while the source continues serving. Volume-backup restore is an
in-place service/volume operation and is therefore not the drill or recovery
cutover mechanism. This procedure uses the PITR sibling described by
[Railway's backup/restore guide](https://docs.railway.com/guides/postgres-backups-restores).

**Restore procedure (the only database rollback path, reserved for data loss):**

1. Contain the affected Data Cell: stop public routing, set
   `BETA_CAPABILITIES_OFF=all`, and scale the cell worker to zero. Record the
   incident/change reference, source cell, exact restore timestamp, active
   40-character release SHA, signed release-manifest SHA-256, source Postgres
   service, and named operator. Do not alter another cell.
2. In the source Postgres service's Railway **Backups** tab, select the exact
   PITR timestamp. Railway creates the sibling; record its generated service
   name as `RESTORE_DATABASE_SERVICE_NAME`. Do not use volume restore and do
   not rename the source or sibling.
3. Connect only to that exact sibling. The supported current command path is a
   reviewed checkout through `railway connect
"$RESTORE_DATABASE_SERVICE_NAME" --tunnel-only`; use the loopback URL it
   prints as `DATABASE_URL`. An in-platform invocation is accepted only when
   the URL is the exact `<service>.railway.internal` hostname and Railway's
   injected project/environment identity names the authoritative `cell-*`
   environment. Public TCP proxies and the live `Postgres.railway.internal`
   service fail closed.
4. Export `RESTORE_MODE=isolated`, `RESTORE_SOURCE_CELL`,
   `PROCESSING_CELL`, `RESTORE_POINT_AT`, `RESTORE_DATABASE_SERVICE_NAME`,
   `RELEASE_SHA`, and `RELEASE_MANIFEST_SHA256` in the verifier process only.
   Never make restore variables shared cell variables. Run
   `pnpm ops:restore-preflight --operator <id>`; it proves target admission and
   migration-journal readability before any mutation.
5. Apply the current release's deploy migration trio to the sibling
   (`pnpm db:migrate-deploy`, advisory-locked and idempotent). Re-run preflight
   and schema parity. If the migration is not forward-safe, stop; do not repair
   the production source or reverse DDL from this workflow.
6. Run `pnpm ops:restore-verify --operator <id>` first as a dry run. Review the
   content-free retention, Google-import, external-effect-authority, and active
   Data Cell move inventory. Any unresolved move blocks recovery.
7. Run `pnpm ops:restore-verify --operator <id> --reason <change-ref> --apply
--yes ops:restore-verify`. The command, in process and without BullMQ:
   applies all overdue retention rules; reconciles Google import retention;
   invalidates restored sessions and verification tokens; cancels pending
   invitations, email/digest work, legacy imports, and unpublished reply
   authority; expires/releases/fences AI and Google permits and operations;
   moves Google connections to reauthorization-required; stalls active AI
   backfills; and recovery-fences every unpublished outbox row. It then writes
   one durable, cell-scoped `recovery_runs` generation and proves zero
   remaining unfenced authority. Exact retries replay the same generation.
   Record the command's printed `run=<uuid>` and recovery generation; these
   are the only accepted serving attestation for the sibling.
8. Re-run the dry run and require all counts to remain zero. Boot a temporary,
   no-public-domain web verifier from the exact signed web image with
   `RESTORE_MODE=isolated` and a service-scoped private sibling URL. Boot
   refuses any source/public/wrong-cell target; capabilities deny every effect.
   Verify migration head, tenant isolation/counts, critical reads, and the
   recovery evidence. Never boot a worker in restore mode.
9. Provision fresh empty queue/provider Redis services; restored queues are
   never reused. Stage the sibling/fresh-Redis references for every Data Cell
   consumer while traffic and effects remain stopped. Do not redrive
   recovery-fenced outbox rows. Set `RECOVERY_CUTOVER_RUN_ID` and
   `RECOVERY_CUTOVER_GENERATION` from step 7 on every sibling consumer. Deploy
   web, verify reads, deploy worker, then **UNSET `RESTORE_MODE`** and remove
   the global capability stop only after all consumers report the same
   release/config/database generation. A web or worker process connected to a
   Railway PITR sibling refuses normal boot unless that tuple still names the
   latest completed recovery run in its exact Data Cell.
10. Reauthorize fenced Google connections, rebuild projections, and reconcile
    current external provider state as new work. Confirm sessions require
    reauthentication, queues contain no restored jobs, source Postgres remains
    untouched, readiness is 200, and no duplicate effect was emitted. Retain
    the old source and PITR sibling under the incident evidence/erasure policy;
    do not delete either during the recovery window.

**Implemented proof.** Unit and real-PostgreSQL integration tests prove target
admission, wrong-cell refusal, worker refusal, idempotent recovery generation,
retention reconciliation, restored-authority fencing, and that fenced outbox
rows cannot be claimed or published. A timed live Railway PITR and cutover is
still required independently for every Data Cell before it becomes accepting.

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

## 5. Data-retention registry (RETENTION_POLICY_VERSION 4)

Evidence for every deletion or redaction lands in `retention_runs` (content-free:
subject, separate deletion/redaction counts, outcome, policy version). Scheduled sweeps run on the
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
| `scan_events.guest_session_pseudonym`    | `scan_events.session_id`                           | 24h                                                                                                                                                                                 | bounded redaction; visit fact remains                                                     |
| `ratings.guest_session_pseudonym`        | `ratings.session_id`                               | 24h                                                                                                                                                                                 | bounded redaction; legacy rating remains                                                  |
| `feedback.guest_session_pseudonym`       | `feedback.session_id`                              | 24h                                                                                                                                                                                 | bounded redaction; legacy feedback remains                                                |
| `scan_events.abuse_pseudonym`            | `scan_events.ip_hash`                              | 7d                                                                                                                                                                                  | bounded redaction; visit fact remains                                                     |
| `ratings.abuse_pseudonym`                | `ratings.ip_hash`                                  | 7d                                                                                                                                                                                  | bounded redaction; legacy rating remains                                                  |
| `feedback.abuse_pseudonym`               | `feedback.ip_hash`                                 | 7d                                                                                                                                                                                  | bounded redaction; legacy feedback remains                                                |
| `outbox_events.published`                | `outbox_events`                                    | 30d from `published_at`                                                                                                                                                             | retention-sweep                                                                           |
| `event_consumer_receipts`                | `event_consumer_receipts`                          | 30d                                                                                                                                                                                 | retention-sweep                                                                           |
| `review_sync_runs`                       | `review_sync_runs`                                 | 30d                                                                                                                                                                                 | retention-sweep                                                                           |
| `review_refresh_runs`                    | `review_refresh_runs`                              | 30d                                                                                                                                                                                 | retention-sweep                                                                           |
| `inbound_webhook_receipts`               | `inbound_webhook_receipts`                         | 30d                                                                                                                                                                                 | retention-sweep                                                                           |
| `notifications`                          | `notifications`                                    | 90d                                                                                                                                                                                 | retention-sweep                                                                           |
| `notification_digest_batches`            | immutable digest batch + member rows               | 90d after accepted/terminal; open retry evidence is retained                                                                                                                        | retention-sweep; member rows cascade with batch                                           |
| `notification_email_queue`               | `notification_email_queue`                         | 90d, terminal states only                                                                                                                                                           | retention-sweep                                                                           |
| `activity_log`                           | `activity_log`                                     | 90d                                                                                                                                                                                 | retention-sweep                                                                           |
| `gbp_cache.expired`                      | `gbp_cache`                                        | at `expires_at`                                                                                                                                                                     | retention-sweep                                                                           |
| `policy_decision_audit`                  | `policy_decision_audit`                            | **365d** (beta audit-trail horizon, BQC-7.8)                                                                                                                                        | retention-sweep                                                                           |
| `audit_logs`                             | `audit_logs`                                       | **365d** (same horizon, BQC-7.8)                                                                                                                                                    | retention-sweep                                                                           |
| `quarantine.ttl`                         | `quarantine` BullMQ queue                          | `QUARANTINE_TTL_DAYS` (default 30d)                                                                                                                                                 | quarantine-ttl-sweep                                                                      |
| `retention_runs`                         | `retention_runs`                                   | **indefinite-by-design** — the evidence chain FOR deletions; deleting it would erase the proof of erasure. Size monitored via the metrics snapshot; no rule exists by deliberation. | none (monitored)                                                                          |

Version history: v1 (BQC-1.6) initial 9-rule registry + lifecycle purges; v2
(BQC-7.8) + `policy_decision_audit` / `audit_logs` at 365d, +
`quarantine.ttl`, Google import lifecycle evidence, and `retention_runs`
documented indefinite-by-design; v3 adds independently counted 24-hour Guest
session-pseudonym and 7-day network-abuse-pseudonym redaction while preserving
the de-identified managerial facts; v4 adds 90-day terminal notification-digest
batch evidence while retaining open retry batches.

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

- **Region:** the signed Data Cell catalogue is authoritative. `us` is the only
  currently accepting cell; `europe` and `global` remain provisioning until
  their independent Railway topology, wrong-cell, provider, and recovery
  evidence passes. No cell fails over to another by policy (runbooks §12).
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
