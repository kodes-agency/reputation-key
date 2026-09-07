# Backup, recovery fencing, and lifecycle configuration

**Date:** 2026-08-25
**Owner:** Bozhidar Denev
**Scope:** PostgreSQL PITR/backups, Redis durability, object lifecycle, log/trace
retention, data-retention registry, quarantine TTL, evidence retention, region/
encryption/access posture for internal beta.

The legacy exit-matrix label is **"Backup/PITR and retention configuration is
documented/active."** Only the documentation and repository retention/recovery
controls are evidenced locally. The latest retained Railway inspection says
backup/PITR is not active, and REG-04/Gate E now requires both activation and a
timed restore before customer data; BQC-8/REG-04 performs that external proof
against the RPO/RTO targets.

Related: [runbooks.md](runbooks.md) §7/§8,
[bqr6-recovery-rehearsal.md](bqr6-recovery-rehearsal.md) (procedure + targets),
[ADR 0038](../adr/0038-beta-service-objectives-and-recovery.md) (RPO ≤ 15 min,
RTO ≤ 4 h), [ADR 0057](../adr/0057-single-us-beta-data-cell.md) (current
single-US beta posture).

---

## 1. PostgreSQL backups / PITR (Railway Postgres)

**Platform.** Production PostgreSQL is Railway Postgres (the web + worker +
migrate services attach to it). Older docs/scripts that say "Neon" are stale —
this document is the current reference.

**Required platform configuration (owner: Bozhidar Denev).** Backups/PITR are
a platform feature, configured and verified in the Railway project console —
NOT in app code (the repository carries no backup knobs at all). This
paragraph is a target procedure, not evidence that it is active.
The latest retained live inspection reports PITR disabled and no backup for the
candidate PostgreSQL service. `cell-us` therefore cannot accept customer data
until a fresh exact-target record proves all items below:

- Railway project → `cell-us` → `Postgres` → **Backups** tab: enable the
  approved schedule and PITR, then retain the exact project/environment/service
  identity, schedule, latest successful point, WAL/PITR health, earliest/latest
  restore range, observation time, and alert-routing test. The restore point
  used in any drill/incident must be inside that range — confirm before
  starting (this is also the `ops:restore-preflight` checklist reminder).
- **Where to verify:** the same Backups panel (schedule, last successful
  backup, WAL/PITR state, and range) at drill time and after any platform plan
  or service change. Repository tests cannot satisfy this check.
- **Target:** PITR granularity must satisfy RPO ≤ 15 min (ADR 0038); BQC-8
  times the actual achieved RPO/RTO in the recovery rehearsal. RPO/RTO are
  internal operating targets, never a customer-facing SLA.

**Catastrophic-loss logical export.** Before customer data, counsel/platform
must approve the export cadence, retention, encryption/key owner, destination
account, and destination region. The destination must be outside the source
Railway project/account while remaining inside the approved legal/residency
boundary. Each run retains only a content-free manifest (source cell/service,
started/completed time, encrypted-object digest and size, schema/migration
head, outcome, and destination policy identifier). Monitor latest-success age
against the approved cadence and exercise a read/restore verification. No
runner, destination, cadence approval, or live success evidence is claimed by
this repository today; this is a release blocker, not an instruction to create
an unapproved export destination.

The exact external monitoring inventory is registered in
`src/shared/observability/regional-platform-signals.ts`: backup age, WAL/PITR
health, restore range, logical-export success, external web availability, error
rate, and release/config drift for `cell-us` only. Application-owned queue,
outbox, reply, Google-sync, and worker-readiness signals remain in
`src/shared/observability/alert-definitions.ts`. A registered row is a required
configuration/evidence contract; it is not deployed alert evidence.

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

1. Contain the deployment: stop public routing, set
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
   injected project/environment identity names the authoritative `cell-us`
   environment. Public TCP proxies and the live `Postgres.railway.internal`
   service fail closed.
4. Export `RESTORE_MODE=isolated`, `RESTORE_POINT_AT`,
   `RESTORE_DATABASE_SERVICE_NAME`, `RELEASE_SHA`, and `RELEASE_MANIFEST_SHA256`
   in the verifier process only. Never make restore variables shared variables. Run
   `pnpm ops:restore-preflight --operator <id>`; it proves target admission and
   migration-journal readability before any mutation.
5. Apply the current release's deploy migration trio to the sibling
   (`pnpm db:migrate-deploy`, advisory-locked and idempotent). Re-run preflight
   and schema parity. If the migration is not forward-safe, stop; do not repair
   the production source or reverse DDL from this workflow.
6. Run `pnpm ops:restore-verify --operator <id>` first as a dry run. Review and
   retain its canonical aggregate Review report and exact approval request,
   together with the content-free retention, Google-import, and
   external-effect-authority inventories. Follow
   [review-lifecycle-recovery-approval](review-lifecycle-recovery-approval.md)
   for independent signing and exact-byte configuration.
7. The checked-in composition remains inspection-only unless all three
   restore-scoped approval values carry a current, trusted, digest-pinned
   Ed25519 bundle for that exact report, target, recovery UUID, generation,
   and policy. Missing, denied, stale, changed, replayed, or untrusted authority
   refuses before mutation. With the independently reviewed bundle configured
   only on the isolated verifier, run
   `pnpm ops:restore-verify --operator <id> --reason <change-ref> --apply --yes
ops:restore-verify`. The authorized command, in process and without BullMQ,
   applies all overdue retention rules; reconciles Google import retention;
   invalidates restored sessions and verification tokens; cancels pending
   invitations, email/digest work, legacy imports, and unpublished reply
   authority; expires/releases/fences AI and Google permits and operations;
   moves Google connections to reauthorization-required; stalls active AI
   backfills; and recovery-fences every unpublished outbox row. It then writes
   one durable, cell-scoped `recovery_runs` generation and proves zero
   remaining unfenced authority. Exact retries replay the same generation.
   Record the authorized command's printed `run=<uuid>` and recovery
   generation; these are the only accepted serving attestation for the sibling.
   The repository executor is local implementation proof only: this step is
   not complete until the actual signed sibling rehearsal succeeds.
8. Re-run the dry run and require all counts to remain zero. Boot a temporary,
   no-public-domain web verifier from the exact signed web image with
   `RESTORE_MODE=isolated` and a service-scoped private sibling URL. Boot
   refuses any source/public target; capabilities deny every effect.
   Verify migration head, tenant isolation/counts, critical reads, and the
   recovery evidence. Never boot a worker in restore mode.
9. Provision fresh empty cache, queue, and provider Redis services; restored queues are
   never reused. Stage the sibling/fresh-Redis references for every
   consumer while traffic and effects remain stopped. Do not redrive
   recovery-fenced outbox rows. Set `RECOVERY_CUTOVER_RUN_ID` and
   `RECOVERY_CUTOVER_GENERATION` from step 7 on every sibling consumer. Deploy
   web, verify reads, deploy worker, then **UNSET `RESTORE_MODE`** and remove
   the global capability stop only after all consumers report the same
   release/config/database generation. A web or worker process connected to a
   Railway PITR sibling refuses normal boot unless that tuple still names the
   latest completed recovery run.
10. Reauthorize fenced Google connections, rebuild projections, and reconcile
    current external provider state as new work. Confirm sessions require
    reauthentication, queues contain no restored jobs, source Postgres remains
    untouched, readiness is 200, and no duplicate effect was emitted. Retain
    the old source and PITR sibling under the incident evidence/erasure policy;
    do not delete either during the recovery window.

**Implemented proof.** Unit and real-PostgreSQL integration tests prove target
admission, worker refusal, idempotent recovery generation,
retention reconciliation, restored-authority fencing, and that fenced outbox
rows cannot be claimed or published. A timed live Railway PITR and cutover is
still required before the deployment becomes accepting.

## 2. Redis durability

**Posture: disposable-and-rebuild, physically split.** `Queue Redis` holds
BullMQ queues only. `Cache Redis` holds cache, rate-limit, alert, and heartbeat
state. Provider authorization/PKCE handles remain on the third, independently
guarded provider Redis. None holds durable facts. The Postgres outbox is the
durable fact store: on queue Redis loss, events accumulate in the outbox and
the relay redrives the backlog when that resource returns (runbooks §7).
Logical database numbers on one daemon are never accepted as isolation.
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

## 3. Object lifecycle (S3-compatible storage)

Portal image uploads are governed by `portal.upload`, which the executable
capability-fate authority currently classifies as **temporarily unavailable**.
Organization or Property policy cannot activate it until the named SAFE-01
readiness record is complete and the product fate is deliberately changed. The
S3-compatible adapter also remains a no-op while its access, bucket, region,
and endpoint variables are incomplete.

The target Railway topology binds those variables to one private, cell-local
`object-store` bucket; the variable names retain their `AWS_S3_*` compatibility
prefix and do not identify the live storage provider. The hourly,
capability-independent `portal-upload-source-cleanup` job expires at most 100
issuances per run, removes only server-derived private source keys, removes
non-published derivative keys for rejected/expired/superseded issuances, and
records separate durable completion timestamps. Deletes are idempotent and a
failed row is retried without losing already recorded progress. Finalized
public variants are never selected as orphans.

Bucket lifecycle remains external platform configuration. Before activation,
record the exact live provider/cell, provider lifecycle rules, deletion and
restore behavior, and an end-to-end drill proving the scheduled cleanup against
the real object store. Repository cleanup authority is not proof that the live
provider accepted or retained each delete.

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

## 5. Data-retention registry (RETENTION_POLICY_VERSION 8)

Evidence for every deletion or redaction lands in `retention_runs` (content-free:
subject, separate deletion/redaction counts, outcome, policy version). Scheduled sweeps run on the
background queue (retention-sweep offset 3h, quarantine-ttl-sweep offset 4h).
The former Review row-delete schedule is deliberately absent. REV-01 expand
storage now separates and atomically erases provider content while preserving
Review/Reply/Inbox identity. All Review-content purge adapters use the same
bounded, checkpointed Review authority. SAFE-03 still keeps recurring execution
quarantined: normal production composition has no apply authorizer, and the job
accepts only report/shadow mode until the backfill/shadow-parity audit,
restore/erasure proof, and checkpointed cutover in
`review-source-content-cutover.md` are sealed.

| Subject                                   | Table / store                                                                                | TTL / trigger                                                                                                                                                                       | Mechanism                                                                                                                                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reviews.purge`                           | `review_source_contents` + nullable `reviews` compatibility cache                            | Source policy: raw content 30d from last fetch (refresh-due 25d) — ADR 0031, no grace                                                                                               | Shared atomic lifecycle authority; recurring job remains report/shadow-only pending parity/cutover seal                                                                                    |
| `reviews.purge.connection`                | `reviews` by connection                                                                      | on disconnect (event-driven)                                                                                                                                                        | shared atomic lifecycle authority (bounded pages)                                                                                                                                          |
| `reviews.purge.property`                  | `reviews` by property                                                                        | on approved property purge                                                                                                                                                          | shared atomic lifecycle authority (bounded pages)                                                                                                                                          |
| `reviews.purge.organization`              | `reviews` by org                                                                             | on approved org purge                                                                                                                                                               | shared atomic lifecycle authority (bounded pages)                                                                                                                                          |
| `inbox_items.purge.property`              | `inbox_items` by property                                                                    | companion of property purge                                                                                                                                                         | source-content purge                                                                                                                                                                       |
| `integration.google_import_v2.lifecycle`  | import parents/items + Property operation receipts                                           | item `effect_deadline_at`; parent fixed `purge_at` at first terminal + 30d; Property receipt fixed 32d and retention release                                                        | receipt-first terminalization, bounded parent purge/release event, released receipt sweep                                                                                                  |
| `guest_contact_requests.expired_material` | encrypted Contact Request email/name material                                                | exact per-row `expires_at`, 30 days after explicit submission                                                                                                                       | Guest-owned serialized/checkpointed bounded redaction through the daily retention sweep; stale reads deny independently; runs even while activation is blocked                             |
| `guest_response_session_bindings.expired` | `guest_response_session_bindings`                                                            | exact signed-session expiry, maximum 24h                                                                                                                                            | bounded deletion; stale reads deny independently of sweep timing                                                                                                                           |
| `guest_response_private_feedback.expired` | `guest_response_private_feedback`                                                            | 90d from private-feedback submission                                                                                                                                                | bounded deletion; stale reads deny independently of sweep timing                                                                                                                           |
| `guest_responses.deidentified_fact`       | content-free `guest_responses` fact/tombstone                                                | 24 calendar months from initial rating                                                                                                                                              | bounded deletion                                                                                                                                                                           |
| `scan_events.guest_session_pseudonym`     | `scan_events.session_id`                                                                     | 24h                                                                                                                                                                                 | bounded redaction; visit fact remains                                                                                                                                                      |
| `ratings.guest_session_pseudonym`         | `ratings.session_id`                                                                         | 24h                                                                                                                                                                                 | bounded redaction; legacy rating remains                                                                                                                                                   |
| `feedback.guest_session_pseudonym`        | `feedback.session_id`                                                                        | 24h                                                                                                                                                                                 | bounded redaction; legacy feedback remains                                                                                                                                                 |
| `idempotency_receipts`                    | Shared external-id idempotency receipts across receipt scopes                                | 30d from `recorded_at`; live 24h dedupe checks still deny independently of sweep timing                                                                                             | retention-sweep                                                                                                                                                                            |
| `guest_network_pressure_records.expired`  | `guest_network_pressure_records`                                                             | exact per-row `expires_at`, seven days after observation                                                                                                                            | bounded complete-row deletion; content-free `retention_runs` evidence                                                                                                                      |
| `ai.authorization_derivatives`            | retired `ai_review_analyses`, Property aggregate rows, and Property Trend schedules/outcomes | authorization transition hides the prior exact generation immediately; physical deletion must complete within 24h                                                                   | PostgreSQL-leased, eight-attempt bounded erasure every five minutes; class-separated lifecycle counts and content-free `retention_runs` evidence; latest failure trips `retention.failure` |
| `scan_events.abuse_pseudonym`             | nullable legacy `scan_events.ip_hash`                                                        | 7d                                                                                                                                                                                  | restore/backfill defence; migration 0142 cleared active rows and canonical writes stay null                                                                                                |
| `ratings.abuse_pseudonym`                 | nullable legacy `ratings.ip_hash`                                                            | 7d                                                                                                                                                                                  | restore/backfill defence; migration 0142 cleared active rows and canonical writes stay null                                                                                                |
| `feedback.abuse_pseudonym`                | nullable legacy `feedback.ip_hash`                                                           | 7d                                                                                                                                                                                  | restore/backfill defence; migration 0142 cleared active rows and canonical writes stay null                                                                                                |
| `outbox_events.published`                 | `outbox_events`                                                                              | 30d from `published_at`                                                                                                                                                             | retention-sweep                                                                                                                                                                            |
| `event_consumer_receipts`                 | `event_consumer_receipts`                                                                    | 30d                                                                                                                                                                                 | retention-sweep                                                                                                                                                                            |
| `review_sync_runs`                        | `review_sync_runs`                                                                           | 30d                                                                                                                                                                                 | retention-sweep                                                                                                                                                                            |
| `review_refresh_runs`                     | `review_refresh_runs`                                                                        | 30d                                                                                                                                                                                 | retention-sweep                                                                                                                                                                            |
| `idempotency_receipts.gbp_webhook`        | `idempotency_receipts` with scope `gbp_webhook`                                              | 30d                                                                                                                                                                                 | retention-sweep                                                                                                                                                                            |
| `notifications`                           | `notifications`                                                                              | 90d                                                                                                                                                                                 | retention-sweep                                                                                                                                                                            |
| `notification_digest_batches`             | immutable digest batch + member rows                                                         | 90d after accepted/terminal; open retry evidence is retained                                                                                                                        | retention-sweep; member rows cascade with batch                                                                                                                                            |
| `notification_email_queue`                | `notification_email_queue`                                                                   | 90d, terminal states only                                                                                                                                                           | retention-sweep                                                                                                                                                                            |
| `recent_activity_replay_facts`            | `recent_activity_replay_facts`                                                               | exactly 90d from `source_occurred_at`                                                                                                                                               | retention-sweep; content-free recovery authority, independent of 30d outbox retention                                                                                                      |
| `recent_activity_actor_label_redactions`  | `recent_activity_actor_label_redactions`                                                     | until `expires_at` (90d from latest bounded actor-label redaction)                                                                                                                  | retention-sweep; content-free privacy fence prevents delayed delivery/rebuild from restoring labels                                                                                        |
| `recent_activity_entries`                 | `recent_activity_entries`                                                                    | 90d                                                                                                                                                                                 | retention-sweep                                                                                                                                                                            |
| `operational_action_history_records`      | Restricted Operational Action History records + tenant-local sequence head                   | Proposed 365d; **assessment-only pending counsel**. Active legal holds override eligibility.                                                                                        | No destructive sweep/apply exists. Bounded assessment emits only counts/cutoff; identifier redaction is one-way and legal-hold-aware.                                                      |
| `operational_action_history_legal_holds`  | Operational Action History legal-hold placement/release evidence                             | Active holds retained; released-hold lifecycle pending counsel-approved policy                                                                                                      | No destructive sweep. Append-oriented placement; database permits only the explicit one-time release transition.                                                                           |
| `gbp_cache.expired`                       | `gbp_cache`                                                                                  | at `expires_at`                                                                                                                                                                     | retention-sweep                                                                                                                                                                            |
| `audit_logs`                              | `audit_logs`                                                                                 | **365d** (same horizon, BQC-7.8)                                                                                                                                                    | retention-sweep                                                                                                                                                                            |
| `quarantine.ttl`                          | `quarantine` BullMQ queue                                                                    | `QUARANTINE_TTL_DAYS` (default 30d)                                                                                                                                                 | quarantine-ttl-sweep                                                                                                                                                                       |
| `retention_runs`                          | `retention_runs`                                                                             | **indefinite-by-design** — the evidence chain FOR deletions; deleting it would erase the proof of erasure. Size monitored via the metrics snapshot; no rule exists by deliberation. | none (monitored)                                                                                                                                                                           |

Version history: v1 (BQC-1.6) initial 9-rule registry + lifecycle purges; v2
(BQC-7.8) + `audit_logs` at 365d, + `quarantine.ttl`, Google import lifecycle
evidence, and `retention_runs`
documented indefinite-by-design; v3 adds independently counted 24-hour Guest
session-pseudonym and 7-day network-abuse-pseudonym redaction while preserving
the de-identified managerial facts; v4 adds 90-day terminal notification-digest
batch evidence while retaining open retry batches; v5 splits signed recovery
authority, private-feedback text, and de-identified
Guest Response facts into independently expiring stores; v6 adds canonical
seven-day Guest network-pressure deletion; v7 adds retired-generation AI
derivative erasure; v8 adds scheduled, bounded Contact Request encrypted-material
expiry evidence without activating Contact Request. `pnpm ops:purge
retention --operator <id>` reports content-free per-rule counts and exact
cutoffs without requiring Redis or changing business rows; `--apply` remains a
separately confirmed bounded enqueue. The report identifies Google import
lifecycle as separately inspected; use `ops:google-import-lifecycle inspect`
for that receipt/parent lifecycle rather than treating the static-rule total as
the whole sweep.

## 6. Evidence retention

- **Deletion evidence** (`retention_runs`) and **action audit** (`audit_logs`):
  per the registry above — action audit at the 365d horizon,
  `retention_runs` indefinite.
- **Restricted Operational Action History:** migration 0149 is a distinct
  identifier-only authority. Its proposed 365-day horizon is not part of the
  retention sweep: local code can assess eligibility/holds but cannot delete.
  Counsel approval, deployed least-privilege proof, and isolated restore/export
  evidence are required before a destructive lifecycle can be designed.
- **CI artifacts** (GitHub Actions): SBOM (`sbom-spdx`) 30d, container image
  SBOMs (`sbom-images-spdx`) 30d, e2e failure artifacts 7d
  (`.github/workflows/ci.yml`).
- **Release evidence**: `docs/release-evidence/beta/` is git-retained
  (permanent, reviewable history).
- **Operational Redis keys**: alert firing-state 24h TTL (re-notify window),
  one global content-free Guest observation-loss hash whose stale five-minute
  bucket fields are pruned on every access and whose key has a refreshed
  24h05m TTL (coverage epoch and counters share the same evictable unit; after
  Cache Redis loss/reset/eviction, monitor state stays explicitly unavailable
  until one full observation window has elapsed),
  worker heartbeat 900s TTL (one missed 5-min beat tolerated).

## 7. Region placement, encryption, access

- **Region:** one deployment, Railway environment `cell-us`, in Railway US
  West/California with object storage in Railway US West/California (`sjc`).
  The identifier does not establish a guaranteed city. Every supported country
  is served there; there is no per-region deployment (`docs/BETA.md` §1).
  Unknown or stale assignments never fall back silently (ADR 0057).
- **Encryption at rest:** platform-managed — Railway Postgres storage and
  service volumes are encrypted by the platform; OAuth tokens are
  additionally AES-256-GCM encrypted at the application layer
  (`ENCRYPTION_KEY`).
- **Encryption in transit:** TLS — `DATABASE_URL` with `sslmode=require`,
  Redis over TLS where the provider endpoint requires it, HTTPS at the
  platform edge (HSTS in production).
- **Access:** each dedicated Railway project (console + env vars + backups +
  logs) is owned by the platform owner (Bozhidar Denev); no shared third-party
  access. Production and rehearsal use separately scoped credentials.
- **Secrets:** stored as Railway service variables, **distinct per
  environment** (production / staging / test identities are separate — the
  BQC-7.6 placeholder-secret boot guard refuses known test values in
  production). `OPS_OPERATOR_IDENTITIES` gates operator commands per
  environment.

---

## 8. Backup-erasure ledger and the restore resurrection fence (LIF-01-T15)

A restore is the one operation that can undo an irreversible erasure. The backup
a cell is restored from predates the purge, so a plain restore silently brings
back every Organization, Property and privacy subject erased after the restore
point. That is the worst outcome in the whole lifecycle package: data the
product promised was destroyed becomes readable again.

**The control.** `backup_erasure_ledger` is an append-only record of every
irreversible erasure — subject class, tenant/property/subject identity, the
owning context, the effective erasure instant, a row count and a content-free
evidence reference. It has **no foreign key** to `organization` or `properties`:
an entry exists precisely because its subject is gone, and a referential
dependency would cascade away the evidence that prevents resurrection. UPDATE,
DELETE and TRUNCATE are refused by `ENABLE ALWAYS` triggers and revoked from
`PUBLIC`, because an entry an operator can quietly remove after a bad restore is
exactly the failure this ledger exists to prevent.

**Where entries come from.**

| Source                          | Subject class     | Lineage                                     |
| ------------------------------- | ----------------- | ------------------------------------------- |
| Organization purge (LIF-01-T14) | `organization`    | closure lineage, one entry per context plan |
| Property Erase (LIF-01-T19)     | `property`        | erase authority id                          |
| Privacy erasure (LIF-01-T20)    | `privacy_subject` | privacy request id                          |

Each append is idempotent by `(subject_class, closure_lineage_id,
lifecycle_revision, context)`, so a retried purge phase cannot inflate the
counts the fence later replays.

**The fence.** `applyRestoreResurrectionFence` (see
`src/shared/db/lifecycle/backup-erasure-ledger.ts`) reads the ledger for the cell and
classifies every entry against the restore point:

- `already_erased` — the erasure took effect at or before the restore point, so
  it is already baked into the restored bytes. Replaying it would double-count.
  This is what makes the fence convergent.
- `replay_required` — the erasure took effect after the restore point, so the
  restore undid it. A registered replayer re-applies it.
- `held` — the entry carries a documented delayed-erasure / legal-hold policy
  reference and no counsel-authorised release. It is deferred, reported, and
  **not** re-applied until a `backup_erasure_hold_release:*` event is appended
  to `organization_lifecycle_events` (itself append-only).

**Fail-closed.** `verified` is false whenever any entry could not be re-applied
— typically because no replayer is registered for its `(context, subjectClass)`.
`assertRestoredCellVerified` throws in that case, and a restored cell that is not
verified must not be opened for traffic. A partially re-erased restore is never
declared verified; being noisy here is strictly better than quietly serving data
the product said was destroyed.

**Operator procedure after a restore.**

1. Run `ops:restore-preflight` as today (restore point inside the platform
   range).
2. Run the recovery fence (`src/shared/db/recovery/postgres-recovery-fence.ts`).
3. Run the resurrection fence with the SAME `restorePointAt`. Record the
   returned `BackupErasureReplayCounts` alongside the `RecoveryFenceCounts` —
   `mergeRecoveryFenceCounts` produces the combined document.
4. If `verified` is false, DO NOT open the cell. Register the missing replayer,
   or obtain a counsel-authorised hold release, and re-run. The fence is
   convergent, so re-running is safe.

**Wiring not yet composed.** `postgres-recovery-fence.ts` does not yet call the
resurrection fence, and only the Guest organization-scoped replayer exists
(`createGuestBackupErasureReplayer`). Until every erasing context registers a
replayer, a restore whose point precedes a purge of another context will
correctly report `verified: false`.

---

## 9. Permanent Property Erase (LIF-01-T19)

**Posture.** `property.erase` is DISABLED in
`src/shared/governance/capability-fate.ts` and is a member of
`BLOCKED_CAPABILITIES` in `src/shared/auth/beta-capabilities.ts`. **It stays
blocked as a tenant capability.** The only entry point is
`pnpm ops:property-erase`. There is no route, no server function and no tenant
capability check that reaches the erase use case — asserted by a negative test
in `src/contexts/property/application/use-cases/erase-property.test.ts`.

An AccountAdmin may **request**. Requesting is not authorizing. Authorization is
a registered operator plus an **independent** support authorization reference
that is not derived from the tenant session or from the requester's identity
verification.

**Gates, in order.**

1. the Property is already `archived` — erasure is not a shortcut past the
   recoverable lifecycle;
2. the requester is a **current** AccountAdmin;
3. an independent, content-free support authorization reference is supplied;
4. the dependency inventory (every owning context's row counts, content-free)
   and the export/retention preview are recorded; and
5. the typed confirmation is exactly `ERASE PROPERTY <property-id>` and names
   the inventory revision the admin was shown. A stale revision is refused.

**State machine.** `requested → previewed → confirmed → purge_pending → purging
→ purged`, with `cancelled` reachable from every state before `purging`.

**The irreversible boundary is `purge_pending → purging`**, guarded three
independent times: the domain transition table, the store's `from` predicate,
and the `property_erase_authorities` database trigger. A cancel attempt after it
is refused with `irreversible_state` in the application and
`irreversible once purging has begun` in direct SQL.

**Asynchronous purge.** `advance-property-erase.job.ts` advances at most ONE
Property per pass. Each context's erase writes an append-only receipt in the
same transaction as its deletes, so an interruption resumes from the receipts
rather than re-running contexts that already answered. A `no_data` receipt is
still evidence — a context with nothing to erase must be distinguishable from a
context that was never asked. Completion appends the backup-erasure ledger entry
described in §8.

**What survives.** The `properties` row survives as a tombstone with its
descriptive content scrubbed: `purged` is a declared lifecycle state and the
tombstone keeps every receipt, audit row and ledger entry that names the
Property resolvable. Sibling Properties in the same Organization are
byte-identical, and independently retained managerial work (replies to reviews
of other Properties, org-level `audit_logs`) is untouched.

**Not yet armed.** `scripts/ops/property-erase.ts` refuses `--apply` and says so.
Only the Guest and Property erase contributors exist; the remaining fourteen
contexts, the container composition and the job registration are pending.

---

## 10. Privacy requests (LIF-01-T20)

`privacy_requests` records access, correction, withdrawal and erasure requests
for Guest contact/feedback and Participant data.

**Structural properties.**

- **Tenant AND property scoped** — both ids are NOT NULL. A request that is not
  bound to exactly one Property cannot be answered without reading across
  tenants.
- **No subject content** — the subject is the SHA-256 of a VERIFIED identifier
  (for a Guest, the Portal session id, hashed inside the database so the
  plaintext never reaches the application). A record about a person's data must
  not become another copy of that person's data.
- **Expiry bound** — an access package reference carries a mandatory expiry and
  a content classification. A privacy export that never expires is a permanent
  secondary copy.
- **No edge skips verification** — `received → verified → in_progress →
fulfilled | refused`, enforced by the domain, the CHECK constraints and the
  `privacy_requests` trigger. Every refusal carries an enumerated reason code;
  there is no free-text refusal.

**The ordering rule.** A withdrawal or correction must reach the anonymous
lifetime aggregate BEFORE the source facts are purged — the same gate the Guest
Organization lifecycle contributor enforces at closure. `fulfilPrivacyRequest`
applies the contributor operation, then delivers corrections, and only then
appends the ledger entry. Undelivered corrections leave the request
`in_progress` with the source facts intact: a retryable stall beats a
permanently wrong aggregate with no fact left to fix it.

**Audit.** Every received and fulfilled request appends
`privacy_request.received` / `privacy_request.fulfilled` carrying the request id
and no subject content. These catalogue actions were declared and unused before
this task.

**Not yet armed.** `scripts/ops/privacy-request.ts` refuses `--apply` and says
so. The Guest subject contributor exists and is proved against real PostgreSQL;
the persistent `PrivacyRequestStore`, the Staff (Participant) contributor and
the Inbox contributor are pending.
