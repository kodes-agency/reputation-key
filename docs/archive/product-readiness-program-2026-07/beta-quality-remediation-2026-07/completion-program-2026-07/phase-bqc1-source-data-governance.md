# BQC-1 — Google Source-Data Governance

**Status:** `not_started`  
**Estimate:** 8–12 engineering days  
**Dependencies:** BQC-0  
**Unlocks:** real Google data eligibility, BQC-3 review cutover, BQC-4 routing, BQC-6 review experience

## 1. Outcome

Make the Review context the sole owner of canonical raw Google review/reply content and guarantee that every raw field is successfully refreshed or removed under the applicable policy. No inbox, activity, event, job, log, cache, evidence, or derived record may become an unmanaged convenience copy.

Expired content is neither served nor sent to another processor, even when a sweeper, consumer, queue, or provider is degraded.

## Ownership mode

BQC-1 `IMPLEMENTS` source classification, lifecycle, eligible reads, copy removal, refresh, and erasure. BQC-3 only `INTEGRATES` the resulting content-free facts into durable delivery; BQC-6 `PROMOTES` lifecycle behavior into UX/release gates; BQC-8 `RE_EXECUTES` it at target scale. Completed BQC-1 modules are not rebuilt in those phases.

## 2. Findings owned

- SPEC-P0-02 — incomplete Google lifecycle/retention.
- STD-P1-03 — protected content in events/activity.
- Source-data portion of SPEC-P0-01 and STD-P0-02.
- Retention portions of SPEC-P1-04 and SPEC-P1-05.

## 3. Policy decisions to finalize first

Translate ADR 0031 and Google's written response into a versioned executable classification for at least:

| Data                                                       | Classification            | Beta rule                                                                                                      |
| ---------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Review text, rating, reviewer name/photo/profile, language | Raw Google source content | Successful-fetch clock; refresh or remove                                                                      |
| Google review/location/account identifiers                 | Raw/provider identifier   | Keep only while required for authorized source operation; remove with source record unless separately approved |
| Google-observed reply text/status                          | Raw Google source content | Same source clock/refresh-or-remove rule                                                                       |
| Local review UUID, property UUID, processing status        | Local operational fact    | Content-free retention schedule                                                                                |
| Sentiment/category/theme later                             | Derived metadata          | Not part of BQC implementation; must be content-free and separately governed                                   |
| Counts/aggregates                                          | Derived/operational       | Prove they cannot reconstruct or embed raw content/exact replies/identifiers                                   |

Resolve backup/PITR treatment with the security/privacy owner: maximum backup retention, restore-time purge, access controls, and deletion evidence. Record the decision in the lifecycle standard/ADR before real data.

## 4. Target deep module

`ReviewSourceLifecycle` is the external seam. Its interface should expose only the behaviors callers need, for example:

- record a successful authorized source observation;
- load policy-eligible content;
- refresh a bounded property batch;
- erase a bounded expired batch and return evidence.

The implementation hides hashing, fetch clocks, row locking, cursoring, content nulling/deletion, copy cleanup, outbox facts, and retention evidence. Routes and dashboards do not reproduce expiry predicates.

The exact TypeScript shape is finalized in the first slice and tested through production PostgreSQL plus an in-memory adapter only where the second adapter provides real value.

## 5. Slices

### BQC-1.1 — Complete field-and-copy inventory

Generate and manually verify an inventory covering:

- canonical review/reply columns;
- inbox denormalized columns;
- activity/notification payload JSON;
- outbox events and consumer receipts;
- BullMQ job bodies, failed jobs, dead-letter/quarantine data;
- logs, traces, error reports, metrics labels;
- dashboard/read-model/cache/materialized-view columns;
- webhook/sync-run records;
- exports, evidence, fixtures, screenshots, browser traces;
- backups/PITR and restored environments.

For every field/copy, record owner, classification, purpose, creation path, read path, TTL/refresh rule, deletion mechanism, evidence, and whether it must be eliminated.

Add a code/schema registry test that fails when a protected field is introduced without a classification.

### BQC-1.2 — Remove raw inbox/activity/transport copies

- Stop storing review text/reviewer identity/rating as an independently retained inbox source copy.
- Keep inbox workflow metadata keyed by local review ID.
- Load review detail through an authorized Review lookup that enforces source eligibility.
- Migrate existing inbox copies to null/content-free state in bounded batches.
- Convert note/rejection/invitation events to identifiers and stable facts; consumers reload authorized content only when necessary.
- Ensure activity and in-app notification facts are content-free under ADRs 0030, 0045, and 0046.
- Prohibit raw content in durable job payloads and quarantine/dead-letter metadata.

If UI latency requires a read model, it remains Review-owned or receives only permitted content with the identical expiry key and an atomic/verified erasure path. Prefer no raw duplicate for beta.

### BQC-1.3 — Correct successful-refetch persistence

- Fix the PostgreSQL upsert so an unchanged successful fetch advances `lastFetchedAt`, `contentExpiresAt`, hash/baseline fields, and permitted source timestamps exactly as the executable policy defines.
- Preserve `firstFetchedAt`.
- Do not emit a semantic content-change event for hash-stable refetch.
- Record a content-free refresh fact/metric if required operationally.
- Compare the real PostgreSQL adapter with the in-memory test behavior to prevent another false-green mismatch.

### BQC-1.4 — Centralize eligible reads

- All review/reply reads used by inbox, dashboard, reply workflow, exports, jobs, and future AI cross `ReviewSourceLifecycle` or a governed query interface.
- Expired/unresolved content returns a typed unavailable outcome, not stale fields.
- Database views/repository predicates provide defense in depth.
- UI states distinguish unavailable/expired, provider disconnected, refresh pending, and permission denied without exposing cached content.

### BQC-1.5 — Bounded refresh with progress and backpressure

- Replace one-shot 5,000-row scans with ordered cursor/lease batches and repeat-until-budget/empty behavior.
- Partition by property/region and enforce concurrency/rate budgets.
- Persist run cursor, counts, oldest due age, failures, next attempt, and terminal state.
- A failed enqueue or provider fetch must fail/retry the job; it cannot be acknowledged as success.
- Purge never treats a failed refresh as a successful observation.
- Alert before policy deadline based on oldest refresh-due/expiry age.

### BQC-1.6 — Safe erasure and valid retention SQL

- Replace invalid `DELETE ... LIMIT` with the documented PostgreSQL CTE/ordered batching pattern or an equivalent tested query.
- Add production schedules/callers for outbox, receipt, sync-run, webhook, notification, activity, cache, and quarantine retention.
- Erasure order must never delete canonical coordination state before required copies are removed.
- Prefer eliminating raw copies; for remaining registered copies, the lifecycle workflow must either co-commit erasure or stop/retry before canonical deletion.
- At hard expiry, reads fail closed independently of sweep completion.
- Retain only content-free deletion evidence: local IDs, policy version, timestamps, counts, outcome, and error code.

### BQC-1.7 — Disconnect/property/org purge

Exercise the same lifecycle module for Google disconnect and approved property/organization purge. Prove source content, identifiers, replies, jobs/caches, and projections are removed or rendered unavailable in bounded, retryable steps without deleting audit evidence required by policy.

## 6. Tests

### Domain and contract

- Exact refresh-due and hard-expiry boundaries with injected clocks.
- Successful unchanged refetch extends only the permitted fetch clock.
- Failed/unauthorized fetch never extends the clock.
- Derived classification rejects raw fields, exact replies, Google identifiers, and reversible fingerprints.

### PostgreSQL

- Real upsert semantics for changed/unchanged/null-hash records.
- Eligible reads exclude exact-boundary/expired data across every public query.
- Ordered cursor batches make progress under concurrent workers.
- Bounded CTE deletion works, repeats, and does not skip permanently locked rows.
- Migration clears legacy copies and can resume safely.

### Runtime/fault

- Refresh enqueue/provider failure retries and blocks purge assumptions.
- Crash before/after each erasure step leaves content unavailable and work resumable.
- Projection scrub failure prevents unsafe canonical finalization and triggers alert/quarantine.
- Restore of an old backup immediately applies lifecycle policy before serving traffic.

### Privacy regression

- Search persisted rows, jobs, logs, traces, evidence, and browser artifacts for seeded canary content/PII.
- Assert canaries exist only in approved active canonical fields and disappear after expiry/disconnect/purge.

## 7. Migration and cutover

1. Expand schema with any missing content-state/evidence/cursor fields.
2. Deploy eligible-read fail-closed behavior before physical cleanup.
3. Stop new denormalized raw copies.
4. Backfill/null legacy copies in ordered tenant batches.
5. Verify canary scans and row counts.
6. Activate refresh/erasure runtime for synthetic data.
7. Observe through at least one accelerated full lifecycle.
8. Contract obsolete raw columns only after all readers are removed.

Rollback keeps reads fail-closed and reverts worker activation, never restores raw convenience copies or extends expiry without Google.

## 8. Evidence

- Approved field/copy inventory and executable policy version.
- PostgreSQL upsert/read/delete results.
- Canary privacy scan before/after expiry.
- Accelerated 30-day lifecycle fault run.
- Restore-time purge result.
- Target-scale lifecycle evidence is completed in BQC-8.

## 9. Exit matrix

| Criterion                                                                | Required result |
| ------------------------------------------------------------------------ | --------------- |
| Every protected field/copy has an owner and executable rule              | Accepted        |
| Review is sole canonical raw-content owner                               | Pass            |
| Events/jobs/activity/notifications contain identifiers/stable facts only | Pass            |
| Stable refetch updates real PostgreSQL lifecycle fields                  | Pass            |
| Every active read denies expired content                                 | Pass            |
| Refresh/erasure is cursor-bounded, retryable, and observable             | Pass            |
| Retention SQL is valid and production-scheduled                          | Pass            |
| Disconnect/purge/restore remove or deny all source content               | Pass            |
| No seeded canary remains after policy expiry                             | Pass            |

## 10. Out of scope

- AI-derived metadata implementation.
- Cross-property or organization summaries.
- Provider selection for Phase 17.
- Enabling guest feedback or other dark public content.
