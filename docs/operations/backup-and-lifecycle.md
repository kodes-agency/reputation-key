# Backup, recovery fencing, and lifecycle configuration

**Date:** 2026-08-25
**Owner:** Bozhidar Denev
**Scope:** PostgreSQL PITR/backups, Redis durability, object lifecycle, log/trace
retention, data-retention registry, quarantine TTL, evidence retention, region/
encryption/access posture for internal beta.

The legacy exit-matrix label is **"Backup/PITR and retention configuration is
documented/active."** Only the documentation and repository retention/recovery
controls are evidenced locally. What Railway holds for the database that serves
the closed beta is recorded in §1 "Recorded backup state of the beta database",
as read on 2026-11-04. REG-04/Gate E requires both activation and a timed
restore before customer data; BQC-8/REG-04 performs that external proof against
the RPO/RTO targets.

Related: [runbooks.md](runbooks.md) §7/§8,
[ADR 0038](../adr/0038-beta-service-objectives-and-recovery.md) (RPO ≤ 15 min,
RTO ≤ 4 h), and [`docs/BETA.md`](../BETA.md) §1 (the current single-deployment
posture).

---

## 1. PostgreSQL backups / PITR (Railway Postgres)

**Platform.** Production PostgreSQL is Railway Postgres (the web + worker +
migrate services attach to it). Older docs/scripts that say "Neon" are stale —
this document is the current reference.

**Required platform configuration (owner: Bozhidar Denev).** Backups/PITR are
a platform feature, configured and verified in the Railway project console —
NOT in app code (the repository carries no backup knobs at all). This
paragraph is a target procedure, not evidence that it is active; the state of
the beta database is recorded below. `cell-us` cannot accept customer data until
a fresh exact-target record proves all items below:

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

**Recorded backup state of the beta database.**
As found in Railway on 2026-11-04, and tested by a restore the same day. That
database is the PostgreSQL service `Postgres` of the Railway environment
`closed-beta-v2`, project `reputation-key`
(`src/shared/release/railway-deployment-profile.ts`), not of `cell-us`, the
dedicated cell the rest of this section is written for and the closed beta does
not run in.

- **Why the targets apply.** The environment is running and serving users, as
  its operator states on 2026-10-13. Its database started empty on 2026-09-05
  and has kept its data across every deploy since (`docs/BETA.md` §7,
  `src/shared/db/CONTEXT.md`), so it is not disposable: the recovery targets of
  ADR 0038 are in force for it, and a point-in-time restore is the only way back
  from a loss of its data.
- **Backups.** Point-in-time recovery (PITR) is on for `Postgres`.
  [Railway's documentation](https://docs.railway.com/volumes/point-in-time-recovery)
  gives the restore window as about four weeks, and no restore point is earlier
  than 2026-11-04. The base backup the rehearsal restored from was taken at
  04:17 UTC on 2026-11-04. Daily backups (kept 6 days) and weekly backups (kept
  27 days) are on.
- **Restore rehearsal, 2026-11-04.** `railway postgres pitr restore` restored
  the database as of 19:50 UTC into a separate service beside the live one,
  which it did not touch. Recovery stopped at the first commit after that
  moment, and rows deleted from the live database after it were still in the
  copy, so the copy reached the moment chosen. The copy accepted connections
  36.5 minutes after the request, having replayed about 15.5 hours of
  write-ahead log from the base backup. A restore can lose about one minute of
  data (`archive_timeout` is 60 seconds). The time grows with the log since the
  last full backup, so expect longer late in a backup cycle; a worst case was
  not measured. The rehearsal tested the data restore only: erasure replay (§8)
  was not tested then; `restore-verify` runs it now.
- **Restored copies.** The private host of a restored service is not its service
  name: read it from the service's `PGHOST`. A restored copy holds the archive
  bucket's credential, so a copy made to rehearse a restore is deleted when the
  rehearsal is over.
- **What the restore commands admit.** The rehearsal did not use the app's own
  verifier, `restore-verify`. The restore target check (`isIsolatedRestoreTarget`,
  `src/shared/config/restore-mode.ts`) admits `closed-beta-v2` and refuses
  `cell-us`: a restore target inside Railway is admitted only when the injected
  environment name is `closed-beta-v2`, the operator names a sibling in Railway's
  PITR shape (`<source>-restored-YYYYMMDD-HHMM`) and the URL is that service's
  exact private hostname. A sibling whose private host differs from its service
  name is refused on that path; the tunnel of step 3 is bound to the sibling's
  name and to no environment. Both restore commands also refuse to start unless
  `RESTORE_MODE=isolated` is set and the process carries no Redis, queue or
  bucket setting (step 4), and they run with no Redis or queue connection. The
  typed confirmation of step 7 and the durable recovery checkpoints are
  unchanged. `restore-verify` runs erasure replay (§8) from `journal=<file>`, and apply
  refuses without it. A full restore to operational state remains unmeasured
  (`docs/BETA.md` §7).
- **Where to check it.** In Railway under `reputation-key` → `closed-beta-v2` →
  `Postgres` → **Backups**.
- **Held to the contract.** `docs/BETA.md` §6 and §7 carry the same finding, and
  `src/shared/db/beta-database-documents.test.ts` fails while this paragraph and
  those two passages disagree about whether the state has been verified.

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

The external monitoring requirements and retained evidence are listed in
[Alerts and security posture](alerts-and-security-posture.md#external-monitoring-requirements):
backup age, WAL/PITR health, restore range, logical-export success, external web
availability, error rate, and release/config drift for `cell-us` only. Application-owned queue,
outbox, reply, Google-sync, and worker-readiness signals remain in
`src/shared/observability/alert-definitions.ts`. A documented requirement is not
deployed alert evidence.

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
   40-character release SHA, release-manifest SHA-256, source Postgres
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
   injected project/environment identity names the authoritative `closed-beta-v2`
   environment. Public TCP proxies and the live `Postgres.railway.internal`
   service fail closed.
4. Export `RESTORE_MODE=isolated`, `RESTORE_POINT_AT`,
   `RESTORE_DATABASE_SERVICE_NAME`, `RELEASE_SHA`, and `RELEASE_MANIFEST_SHA256`
   in the verifier process only. Never make restore variables shared variables.
   Carry no Redis, queue or bucket setting into that process (`REDIS_URL`,
   `QUEUE_REDIS_URL`, `PROVIDER_EPHEMERAL_REDIS_URL`, `AWS_S3_ACCESS_KEY`,
   `AWS_S3_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET_NAME`, `S3_INTERNAL_ENDPOINT`,
   `S3_PRESIGN_ENDPOINT`): a command started from the live environment, as
   `railway run` does, has them, and both restore commands refuse to start with
   any of them, a loopback value included. Run
   `pnpm ops restore-preflight --operator <id>`; it proves target admission and
   migration-journal readability before any mutation.
5. Apply the current release's deploy migration trio to the sibling
   (`pnpm db:migrate-deploy`, advisory-locked and idempotent). Re-run preflight
   and schema parity. If the migration is not forward-safe, stop; do not repair
   the production source or reverse DDL from this workflow.
6. Run `pnpm ops restore-verify --operator <id> journal=<file>` first as a dry run. Review and
   retain its canonical aggregate Review report and recovery request,
   together with the content-free retention, Google-import, and
   external-effect-authority inventories. Follow
   [review-lifecycle-recovery-approval](review-lifecycle-recovery-approval.md)
   for typed confirmation and durable recovery progress.
7. Confirm the beta environment by typing its exact name:
   `pnpm ops restore-verify --operator <id> journal=<file> --reason <change-ref> --apply --yes closed-beta-v2`.
   A missing or different name refuses before runtime boot or mutation. The
   command logs the environment, operator, time and correlation ID before
   reserving or resuming the durable Review recovery receipt. No signed bundle
   or trusted keyring exists or is read. The authorized command, without BullMQ,
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
   not a substitute for an isolated data restore rehearsal.
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
rows cannot be claimed or published. None of that is a live restore. The one
live Railway PITR restore recorded in this repository is the rehearsal of
2026-11-04 ("Recorded backup state of the beta database" above). It restored
into a separate service; `restore-verify` and a cutover were not run.

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
dependency. Recurring job schedulers live in Queue Redis too; the worker's
one-minute scheduler watchdog re-installs any that a Redis restart dropped,
for the plan its boot recorded there (runbooks §7).

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

Identity avatar and organization-logo uploads use the shared arbitrary-key
storage stack through `container.assetStorage`. Portal images enter through one
server-side ingest (`POST /api/portal-media`, ADR 0063): the bytes are decoded
and re-encoded to WebP on the web process and stored under `portal-media/<id>.webp`
with a `portal_media_assets` row; there is no presigned browser upload and no
issuance table. A guest's browser reads an image through the app, from
`GET /api/public/portal-media/:assetId`; the bucket is never public (the app
reads objects and serves two kinds of them, see the avatar and logo notes below).
`portal.upload` is on for every Organization (the owner removed the SAFE-01
ceremony on 2026-09-30; ADR 0032 and 0063).

Portal objects are removed by three paths, none of which depends on the upload
capability: a takedown (the object goes after the row stops being served, and a
failure is retried), the hourly `portal-media-sweep` job (finishes takedown
removals and deletes images nothing refers to, a day after upload), and the
Organization purge (the Portal contributor deletes the objects before their rows).
An ingest whose row insert fails and whose cleanup delete also fails leaves one
orphaned object and logs `portal_media_orphan_object`; remove it by key from the
bucket. The S3-compatible adapter remains a no-op while its access, bucket,
region, and endpoint variables are incomplete.

What names an image decides when it can go. An image is referenced by a Property's
Brand Profile (`logo_asset_id`, `hero_asset_id`), by a link tile (`image_asset_id`), by
a Portal's own look (`portal_look_overrides.hero_asset_id` and `logo_asset_id`, ADR 0070) and by any publication snapshot that names it; the hourly sweep deletes an
unreferenced `active` image a day after upload, and counts the Portal's own look among
the references. The foreign keys from `portal_look_overrides` are RESTRICT, so a
referenced image cannot be deleted from under a Portal. The table is a child of
Portals and is purged with the other Portal rows, after `portal_localized_overrides` and
before the Property's brand contents and profiles, the media assets and the Portals
(foreign-key order), and the Organization export carries it as the `portalLookOverrides`
collection (one row per Portal that has an own look, its columns listed one by one,
with the photo's descriptions as text; no image bytes). Its data fate is
`erasable_source_content` (POR-01/LIF-01). Archiving or deleting a Portal does not remove
its row, so an archived Portal's own photo and logo stay referenced, are never swept,
and keep counting toward the 200-image cap of the Property until an Organization purge
(owner decision D12 of 2026-10-26).

The target Railway topology binds those variables to one private, cell-local
`object-store` bucket; the variable names retain their `AWS_S3_*` compatibility
prefix and do not identify the live storage provider.

**Live bucket (beta, recorded 2026-10-01).** Railway bucket `object-store`
(region `sjc`, private; Railway has no public buckets), wired on web and worker as
`AWS_S3_ACCESS_KEY`, `AWS_S3_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET_NAME` (the
generated S3 name, display name plus a short hash), `AWS_S3_REGION=auto`,
`S3_INTERNAL_ENDPOINT=S3_PRESIGN_ENDPOINT=https://t3.storageapi.dev` and
`S3_FORCE_PATH_STYLE=false`. Railway addresses a bucket by virtual-host URL, so a
signed URL is `https://<bucket>.t3.storageapi.dev/<key>`.

How each path works against it:

- **Portal images** are written and read by the server (`putObject`,
  `getObject`) and served from `/api/public/portal-media/:assetId`. No browser
  ever talks to the bucket and no CORS rule is involved.
- **Avatars and organization logos** are uploaded by the browser with a presigned
  `PUT` (`avatars/<user>/<uuid>`, `organizations/<org>/logo/<uuid>`), checked by
  the server (`inspectObject` is a `HEAD` that reads the stored size; it returns
  no URL), and stored as a
  root-relative path on the app, `/api/public/identity-assets/<key>`. No provider
  or AWS URL and no host is stored, so the value survives a change of endpoint,
  region, provider or domain. The route reads the object back and serves it, for
  the two key shapes above and only for `image/jpeg|png|webp|gif`, with an ETag
  (the object id) and `304` support. **It serves an object only while something
  still points at it:** the user in the key has it as their `image`, or the
  organization in the key has it as its `logo` and is not `purging` or `closed`.
  A replaced picture, an upload that was never saved, a removed user's photo and a
  purged organization's logo are 404. A cache that already holds an image may
  keep showing it for up to its `max-age` (one hour). Saving a new avatar or logo
  deletes the object it replaced (best effort, logged on failure).
  **What stays in the bucket:** unreachable objects of a never-saved upload, of a
  purged organization and of a removed user (the Organization purge and user
  removal hold no storage and delete none). Set a bucket lifecycle rule that
  expires `avatars/` and `organizations/` objects nothing refers to, or sweep
  them by key, when the storage policy is decided.
  **The 5 MB cap is the app's, not the store's.** The signed upload address
  carries no length bound and stays valid for an hour, so the bytes a signed-in
  member sends to it can be any size the bucket accepts. The app reads the
  stored size, and refuses and deletes an object over 5 MB, at the finalize step
  of both uploads and again where an avatar's address is saved
  (`updateUserImageFn`), because a caller can skip the finalize step. A logo's
  address is saved only by its finalize step (`updateOrganization` refuses the
  address of an uploaded picture). That check judges the object as it is at
  that moment: the signed address can still replace it, at any size, until its
  hour ends, so an object over the cap can end up referenced. What holds
  whatever was sent is that nothing over the cap is served: the image route
  reads at most 5 MB and answers 404 for a larger object. An upload that is
  never saved is not checked and stays, at whatever size, until the rule above
  exists.
  Values stored before this change (an `s3.<region>.amazonaws.com` address) never
  loaded; migration 0053 clears them so the UI shows initials, and the person
  uploads again (detection query in `docs/operations/operator-commands.md`).
- **Content Security Policy.** `connect-src` carries the origin the upload is
  signed for, derived from `S3_PRESIGN_ENDPOINT` (else `S3_INTERNAL_ENDPOINT`),
  `AWS_S3_BUCKET_NAME` and `S3_FORCE_PATH_STYLE`: here
  `https://<bucket>.t3.storageapi.dev`. `img-src` needs nothing for the bucket,
  because images are same-origin.
- **Signatures.** The clients send checksums only when the protocol requires
  them (`requestChecksumCalculation: WHEN_REQUIRED`). The SDK default signs the
  checksum of an empty body into a presigned `PUT`, which a store that checks it
  rejects for any real file.

**Bucket CORS, set by `pnpm ops storage-cors`.** A browser `PUT` to the bucket is
cross-origin. Without a CORS rule the avatar and logo uploads fail in the browser
even though the signature is right, and nothing in the app can see that. The
command reads the web service's `AWS_S3_*`, `S3_PRESIGN_ENDPOINT` (else
`S3_INTERNAL_ENDPOINT`) and `BETTER_AUTH_URL` from Railway, and through the
repository-pinned S3 SDK:

- report mode (the default) reads the bucket's rules and exits 1 unless one lets
  the app origin `PUT`;
- `--apply` adds `{AllowedOrigins: [<BETTER_AUTH_URL origin>], AllowedMethods:
[PUT], AllowedHeaders: [*], MaxAgeSeconds: 3000}` when no rule does, keeps every
  rule the bucket already has, reads the bucket back and exits 1 unless the rule
  is there. Idempotent; the credentials never leave the process.

`pnpm ops deploy-ci-images` runs it after every deploy (applying on `--apply`,
reporting otherwise) and fails the command if the rule is not in place, so the
beta does not ship with uploads blocked unnoticed. Drill after the first deploy
that carries it: sign in on the beta, upload one avatar and one organization
logo, check that the browser's `PUT` returns 2xx and that the picture then loads
from `/api/public/identity-assets/...`, then replace it and check the old path
answers 404. Record the date and result here. **Not yet done:** the live drill
(it needs the deployed beta; the code and tests ran against an in-process store).

Bucket lifecycle remains external platform configuration. Before changing the
live storage surface, record the exact provider/cell, provider lifecycle rules,
deletion and restore behavior, and an end-to-end drill against the real object
store. Repository storage authority is not proof that the live provider
accepted or retained each operation.

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

## 5. Data-retention registry (RETENTION_POLICY_VERSION 9)

Evidence for every deletion or redaction lands in `retention_runs` (content-free:
subject, separate deletion/redaction counts, outcome, policy version). Scheduled sweeps run on the
background queue (retention-sweep offset 3h, quarantine-ttl-sweep offset 4h).
The former Review row-delete schedule is deliberately absent. REV-01 expand
storage now separates and atomically erases provider content while preserving
Review/Reply/Inbox identity. All Review-content purge adapters use the same
bounded, checkpointed Review authority. SAFE-03 still keeps recurring execution
quarantined: normal production composition has no apply authorizer, and the job
accepts only report/shadow mode until the backfill/shadow-parity audit,
restore/erasure proof, and an independently approved checkpointed cutover are
sealed.

| Subject                                         | Table / store                                                                                                                       | TTL / trigger                                                                                                                                                                                                                                                                                                                                                                                        | Mechanism                                                                                                                                                                                                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reviews.purge`                                 | `review_source_contents`                                                                                                            | Source policy: raw content 30d from last fetch (refresh-due 25d) — ADR 0031, no grace                                                                                                                                                                                                                                                                                                                | Shared atomic lifecycle authority; recurring job remains report/shadow-only pending parity/cutover seal                                                                                                                                                  |
| `reviews.purge.connection`                      | `reviews` by connection                                                                                                             | on disconnect (event-driven)                                                                                                                                                                                                                                                                                                                                                                         | shared atomic lifecycle authority (bounded pages)                                                                                                                                                                                                        |
| `reviews.purge.property`                        | `reviews` by property                                                                                                               | on approved property purge                                                                                                                                                                                                                                                                                                                                                                           | shared atomic lifecycle authority (bounded pages)                                                                                                                                                                                                        |
| `reviews.purge.organization`                    | `reviews` by org                                                                                                                    | on approved org purge                                                                                                                                                                                                                                                                                                                                                                                | shared atomic lifecycle authority (bounded pages)                                                                                                                                                                                                        |
| `inbox_items.purge.property`                    | `inbox_items` by property                                                                                                           | companion of property purge                                                                                                                                                                                                                                                                                                                                                                          | source-content purge                                                                                                                                                                                                                                     |
| `integration.google_import_v2.lifecycle`        | import parents/items + Property operation receipts                                                                                  | item `effect_deadline_at`; parent fixed `purge_at` at first terminal + 30d; Property receipt fixed 32d and retention release                                                                                                                                                                                                                                                                         | receipt-first terminalization, bounded parent purge/release event, released receipt sweep                                                                                                                                                                |
| `review_source_observations.superseded_expired` | provider content of superseded `review_source_observations` rows (not the Review's newest)                                          | per-row `content_expires_at`, 30 days after the last fetch that returned that copy                                                                                                                                                                                                                                                                                                                   | Review-owned bounded redaction (500 rows a batch, 100 batches a run) through the daily retention sweep; keeps digests, comparison and revision; sets `content_state = source_expired` (ADR 0055, note 2026-10-24 (b))                                    |
| `review_provider_snapshot_runs.superseded`      | `review_provider_snapshot_runs` with their `review_provider_snapshot_members` and removal candidates                                | keeps the active run, the latest completed run of each Property source epoch and the latest three runs of each Property (runs ended by `cursor_lost` or `connection_unusable` are not counted among the three); deletes the rest                                                                                                                                                                     | Review-owned bounded deletion through the daily retention sweep (20 runs and at most 5,000 member rows a batch, `FOR UPDATE SKIP LOCKED`, 100 batches a run); writes the unlisted-review hold count onto a mapping before deleting the run that began it |
| `guest_contact_requests.expired_material`       | encrypted Contact Request email/name material                                                                                       | exact per-row `expires_at`, 30 days after explicit submission                                                                                                                                                                                                                                                                                                                                        | Guest-owned serialized/checkpointed bounded redaction through the daily retention sweep; stale reads deny independently; runs even while activation is blocked                                                                                           |
| `guest_response_session_bindings.expired`       | `guest_response_session_bindings`                                                                                                   | exact signed-session expiry, maximum 24h                                                                                                                                                                                                                                                                                                                                                             | bounded deletion; stale reads deny independently of sweep timing                                                                                                                                                                                         |
| `guest_response_private_feedback.expired`       | `guest_response_private_feedback`                                                                                                   | 90d from private-feedback submission                                                                                                                                                                                                                                                                                                                                                                 | bounded deletion; stale reads deny independently of sweep timing                                                                                                                                                                                         |
| `guest_responses.deidentified_fact`             | content-free `guest_responses` fact/tombstone                                                                                       | 24 calendar months from initial rating                                                                                                                                                                                                                                                                                                                                                               | bounded deletion                                                                                                                                                                                                                                         |
| `guest_qualified_scans.deidentified_fact`       | counted visit (`guest_qualified_scans`); identifiers and a time only                                                                | 24 UTC calendar months from the visit (`occurred_at`); counted back from the run because the row stamps no deadline                                                                                                                                                                                                                                                                                  | bounded deletion                                                                                                                                                                                                                                         |
| `scan_events.deidentified_fact`                 | visit record (`scan_events`), content-free once its pseudonyms are cleared                                                          | 24 UTC calendar months from the visit (`created_at`)                                                                                                                                                                                                                                                                                                                                                 | bounded deletion                                                                                                                                                                                                                                         |
| `scan_events.guest_session_pseudonym`           | `scan_events.session_id`                                                                                                            | 24h                                                                                                                                                                                                                                                                                                                                                                                                  | bounded redaction; visit fact remains                                                                                                                                                                                                                    |
| `idempotency_receipts`                          | Shared external-id idempotency receipts across receipt scopes                                                                       | 30d from `recorded_at`; live 24h dedupe checks still deny independently of sweep timing                                                                                                                                                                                                                                                                                                              | retention-sweep                                                                                                                                                                                                                                          |
| `guest_network_pressure_records.expired`        | `guest_network_pressure_records`                                                                                                    | exact per-row `expires_at`, seven days after observation                                                                                                                                                                                                                                                                                                                                             | bounded complete-row deletion; content-free `retention_runs` evidence                                                                                                                                                                                    |
| `ai_review_analyses.v3_expired`                 | Review Analysis v3 `ai_review_analyses`, with their mention, sentence-number, contribution and contribution-mention rows by cascade | `expires_at` stamped at generation (completion + 730 days); a v2 analysis is not reached                                                                                                                                                                                                                                                                                                             |
| `ai_property_issue_groups.expired`              | Property-local Review Analysis v3 issue groups, with members and merged redirects by cascade                                        | greatest assigned analysis `expires_at`, only after no aggregate contribution mention references the group; rename, hide and merge do not extend it                                                                                                                                                                                                                                                  |
| `ai.authorization_derivatives`                  | retired `ai_review_analyses`, Property aggregate rows, and Property Trend schedules/outcomes                                        | authorization transition hides the prior exact generation immediately; physical deletion must complete within 24h                                                                                                                                                                                                                                                                                    | PostgreSQL-leased, eight-attempt bounded erasure every five minutes; class-separated lifecycle counts and content-free `retention_runs` evidence; latest failure trips `retention.failure`                                                               |
| `scan_events.abuse_pseudonym`                   | nullable legacy `scan_events.ip_hash`                                                                                               | 7d                                                                                                                                                                                                                                                                                                                                                                                                   | restore/backfill defence; migration 0142 cleared active rows and canonical writes stay null                                                                                                                                                              |
| `outbox_events.published`                       | `outbox_events`                                                                                                                     | 30d from `published_at`                                                                                                                                                                                                                                                                                                                                                                              | retention-sweep                                                                                                                                                                                                                                          |
| `event_consumer_receipts`                       | `event_consumer_receipts`                                                                                                           | With its outbox event, 30d from that event's `published_at`. **No subject and no rule of its own**: the `event_id` foreign key cascades, so a receipt never leaves before the fact it guards (redelivery replays a published fact that has no receipt)                                                                                                                                               | `outbox_events.published` (cascade); deletions are counted by event, not by receipt                                                                                                                                                                      |
| `review_sync_runs`                              | `review_sync_runs`                                                                                                                  | 30d                                                                                                                                                                                                                                                                                                                                                                                                  | retention-sweep                                                                                                                                                                                                                                          |
| `review_first_sightings`                        | `review_first_sightings` (push health ledger: ids, a method, instants)                                                              | 30d from `first_seen_at`                                                                                                                                                                                                                                                                                                                                                                             | retention-sweep; cascades with the Property; Review Organization purge deletes it; not exported                                                                                                                                                          |
| `review_refresh_runs`                           | `review_refresh_runs`                                                                                                               | 30d                                                                                                                                                                                                                                                                                                                                                                                                  | retention-sweep                                                                                                                                                                                                                                          |
| `idempotency_receipts.gbp_webhook`              | `idempotency_receipts` with scope `gbp_webhook`                                                                                     | 30d                                                                                                                                                                                                                                                                                                                                                                                                  | retention-sweep                                                                                                                                                                                                                                          |
| `notifications`                                 | `notifications`                                                                                                                     | 90d from the latest arrival (`coalesced_latest_at`, else `created_at`); reading does not extend it                                                                                                                                                                                                                                                                                                   | retention-sweep (`notifications`, `notifications.coalesced`)                                                                                                                                                                                             |
| `notification_digest_batches`                   | immutable digest batch + member rows                                                                                                | 90d after accepted/terminal; open retry evidence is retained                                                                                                                                                                                                                                                                                                                                         | retention-sweep; member rows cascade with batch                                                                                                                                                                                                          |
| `notification_email_queue`                      | `notification_email_queue`                                                                                                          | 90d, terminal states only; a row whose notification retention removed goes with it, whatever its state                                                                                                                                                                                                                                                                                               | retention-sweep                                                                                                                                                                                                                                          |
| `notification_email_suppressions`               | addresses the email provider refused for good (permanent bounce, complaint, provider suppression)                                   | **indefinite-by-design** — a complainer must never be mailed again once the queue rows that proved it are gone; rows hold a server-keyed HMAC of the address and a reason only, and belong to no Organization, so an Organization purge keeps them; an entry leaves when the provider lifts its own suppression. No manager-account erasure path exists yet; one must forget the erased address here | none; Resend `suppression.removed` webhook                                                                                                                                                                                                               |
|                                                 | `notification_email_suppression_removals`                                                                                           | when the provider last lifted an address from its suppression list, keyed by the keyed digest of the address                                                                                                                                                                                                                                                                                         | one row per address, replaced in place; kept so a delayed bounce from before the lifting is not applied again; holds a digest and a time only                                                                                                            | none; removed with the address when it is forgotten |
|                                                 | `resend_webhook_deliveries`                                                                                                         | provider webhook delivery ids already applied, so a redelivery is acknowledged only                                                                                                                                                                                                                                                                                                                  | 7d from `applied_at`, past the provider retry window                                                                                                                                                                                                     | retention-sweep                                     |
| `notification_unsubscribe_scopes`               | the optional (Property, category) scopes a delivered message's one-click unsubscribe link stands for                                | 365d from `created_at` — past the 90-day queue, so an unsubscribe link keeps working while the mail sits in an inbox                                                                                                                                                                                                                                                                                 | retention-sweep; Property hard delete cascades                                                                                                                                                                                                           |
| `recent_activity_replay_facts`                  | `recent_activity_replay_facts`                                                                                                      | exactly 90d from `source_occurred_at`                                                                                                                                                                                                                                                                                                                                                                | retention-sweep; content-free recovery authority, independent of 30d outbox retention                                                                                                                                                                    |
| `recent_activity_actor_label_redactions`        | `recent_activity_actor_label_redactions`                                                                                            | until `expires_at` (90d from latest bounded actor-label redaction)                                                                                                                                                                                                                                                                                                                                   | retention-sweep; content-free privacy fence prevents delayed delivery/rebuild from restoring labels                                                                                                                                                      |
| `recent_activity_entries`                       | `recent_activity_entries`                                                                                                           | 90d                                                                                                                                                                                                                                                                                                                                                                                                  | retention-sweep                                                                                                                                                                                                                                          |
| `operational_action_history_records`            | Restricted Operational Action History records + tenant-local sequence head                                                          | Proposed 365d; **assessment-only pending counsel**. Active legal holds override eligibility.                                                                                                                                                                                                                                                                                                         | No destructive sweep/apply exists. Bounded assessment emits only counts/cutoff; identifier redaction is one-way and legal-hold-aware.                                                                                                                    |
| `operational_action_history_legal_holds`        | Operational Action History legal-hold placement/release evidence                                                                    | Active holds retained; released-hold lifecycle pending counsel-approved policy                                                                                                                                                                                                                                                                                                                       | No destructive sweep. Append-oriented placement; database permits only the explicit one-time release transition.                                                                                                                                         |
| `gbp_cache.expired`                             | `gbp_cache`                                                                                                                         | at `expires_at`                                                                                                                                                                                                                                                                                                                                                                                      | retention-sweep                                                                                                                                                                                                                                          |
| `audit_logs`                                    | `audit_logs`                                                                                                                        | **365d** (same horizon, BQC-7.8)                                                                                                                                                                                                                                                                                                                                                                     | retention-sweep                                                                                                                                                                                                                                          |
| `quarantine.ttl`                                | `quarantine` BullMQ queue                                                                                                           | `QUARANTINE_TTL_DAYS` (default 30d)                                                                                                                                                                                                                                                                                                                                                                  | quarantine-ttl-sweep                                                                                                                                                                                                                                     |
| `retention_runs`                                | `retention_runs`                                                                                                                    | **indefinite-by-design** — the evidence chain FOR deletions; deleting it would erase the proof of erasure. Size monitored via the metrics snapshot; no rule exists by deliberation.                                                                                                                                                                                                                  | none (monitored)                                                                                                                                                                                                                                         |

The Guest session identifier has two horizons in this table. Its own records end
at 24h (`guest_response_session_bindings.expired` and the three
`*.guest_session_pseudonym` redactions). The `idempotency_receipts` subject also
covers the Guest scopes `guest_qualified_scan` and `guest_destination_action`,
whose key and payload carry the same identifier, so those receipts keep it for
30d. The Privacy Notice has stated both figures since version 2.1
(`docs/BETA.md` §2, §3).

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
expiry evidence without activating Contact Request; v9 retires the
`event_consumer_receipts` subject, because a consumer receipt is deleted with
its outbox event and never by a rule of its own, and adds 24-month deletion of
the counted Guest visit and the Guest visit record. `pnpm ops purge
retention --operator <id>` reports content-free per-rule counts and exact
cutoffs without requiring Redis or changing business rows; `--apply` remains a
separately confirmed bounded enqueue. The report identifies Google import
lifecycle as separately inspected and does not count it. No operator command
inspects that receipt/parent lifecycle: read the `retention_runs` rows the daily
sweep writes under subject `integration.google_import_v2.lifecycle`, and do not
treat the static-rule total as the whole sweep.

## 6. Evidence retention

- **Deletion evidence** (`retention_runs`) and **action audit** (`audit_logs`):
  per the registry above — action audit at the 365d horizon,
  `retention_runs` indefinite.
- **Restricted Operational Action History:** migration 0149 is a distinct
  identifier-only authority. Its proposed 365-day horizon is not part of the
  retention sweep: local code can assess eligibility/holds but cannot delete.
  Counsel approval, deployed least-privilege proof, and isolated restore/export
  evidence are required before a destructive lifecycle can be designed.
- **CI artifacts** (GitHub Actions): SBOM (`source-sbom-spdx`) 30d, container image
  SBOMs (`image-sboms-spdx`) 30d, e2e failure artifacts 7d
  (`.github/workflows/ci.yml`).
- **Release evidence**: the historical `cnv-01` pack is permanently retained at
  protected tag [docs-archive-2026-11-05](https://github.com/kodes-agency/reputation-key/tree/docs-archive-2026-11-05/docs/release-evidence/cnv-01).
  No scale or recovery packs are generated.
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

**Inactive foundations.** The table `backup_erasure_ledger` and the append
helper in `src/shared/db/lifecycle/backup-erasure-ledger.ts` exist, but no
production caller records erasures through that helper. This is not an active
erasure journal.

`ops:restore-verify` feeds a local journal export (`journal=<file>`) to
`applyRestoreResurrectionFence` with the replayers composed by
`composeRightsReplayers`, and fails unless every entry is re-applied. An altered
export is refused before any work.

A restore does not automatically re-apply erasures made after its restore point,
and no active journal establishes a complete list of those erasures. Identify
and re-apply them manually before opening the restored cell. The isolated data
restore rehearsal does not prove this recovery step.

---

## 9. Property erasure and privacy requests

Both run through `pnpm ops rights-request` (`docs/operations/rights-requests.md`):
scope `property` for a permanent Property erase, `guest-response` and
`participant` for a person's data. Apply is available in every environment. It
needs a verified identity, a verification reference, a reason, a ticket, the
exact typed confirmation and `--yes ops:rights-request`; it checks that the
Organization exists and that a Property belongs to it; it writes each context's
journal object to the private bucket before that context deletes anything, and a
failed write stops the run; and it records one audit event for the run. A stopped
run resumes by running the same command again. Each owner approves a one-off
erasure at the time.

`property.erase` stays a blocked tenant capability in
`src/shared/governance/capability-fate.ts`: no route, server function or tenant
capability check reaches an erase.

Guest corrections reach the anonymous lifetime aggregate before the source facts
are erased: the Guest executor refuses while a Guest fact is still unpublished.

**What survives.** The `properties` row survives as a tombstone with its name,
slug and address scrubbed: `purged` is a declared lifecycle state and the
tombstone keeps every receipt, audit row and ledger entry that names the
Property resolvable. Sibling Properties in the same Organization are
byte-identical, and independently retained managerial work (replies to reviews
of other Properties, org-level `audit_logs`) is untouched.

**Tombstone rule (owner decision).** An erased Property keeps a minimal
tombstone: the Property id, its Organization, the erase date
(`lifecycle_state_changed_at`) and `lifecycle_reason` set to `erased on
request`. Nothing in it is about a person. The erase also clears the archive
note, the initiating user, the profile confirmation and the Google binding in
the same statement: the account and location suffixes, the Organization
connection reference, the binding state (now `unbound`), the review URI and its
pin, and the primary category. The source epoch moves by one, which fences late
sync writes prepared against the old binding. Because the location suffix is
gone, the per-Organization unique index no longer holds it, and a later
reconnect of the same Google location creates a fresh Property instead of
answering `location_already_bound`.

The Google executor owns the rest of the Google footprint (the Property's
import items and the parents they leave empty); the Property erase does not
repeat it. The Google connection itself belongs to the Organization and stays.
