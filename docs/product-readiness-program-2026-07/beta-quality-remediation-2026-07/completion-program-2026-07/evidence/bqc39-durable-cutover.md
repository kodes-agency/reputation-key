# BQC-3.9 — Durable Cutover: Flags, Shadow Compare, Synthetic Proof, Orphan Consume-or-Retire

**Date:** 2026-07-18 · **Slice:** BQC-3.9 (final BQC-3 slice) · **Phase:** `phase-bqc3-durable-runtime.md` §3.9, §7, §9
**Code:** `src/shared/outbox/cutover-flags.ts` · `src/shared/outbox/shadow-compare.ts` · `src/shared/jobs/readiness.ts` · `src/contexts/inbox/infrastructure/event-handlers/index.ts`
**Proof:** `src/shared/outbox/infrastructure/repositories/durable-cutover.test.ts` (integration project: real PostgreSQL + real BullMQ/Redis)

## 1. Per-family cutover flags (§7)

Each inbox projection family (`review.created`, `review.updated`, `review.expired`, `review.reply.published` — the four families whose durable consumers live in `src/contexts/inbox/infrastructure/outbox-consumers.ts`) moves through three states independently:

| State         | Semantics                                                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `record-only` | Facts recorded to the outbox atomically with the source write; the in-process bus is the primary projection path. **Production default (today's posture).** |
| `shadow`      | BOTH paths run (durable dispatcher must be enabled); the shadow-compare harness contrasts the projection outcome of each path for the same event.           |
| `switch`      | The durable path is authoritative; the family's bus handlers are **not registered** (legacy primary retired for that family — flag-gated, never deleted).   |

**Env encoding** (simplest honest form — no JSON document):

```
DURABLE_CUTOVER_INBOX=shadow                         # group default for all four families
DURABLE_CUTOVER_INBOX_REVIEW_CREATED=switch          # per-family override
DURABLE_CUTOVER_INBOX_REVIEW_UPDATED=shadow
DURABLE_CUTOVER_INBOX_REVIEW_EXPIRED=record-only
DURABLE_CUTOVER_INBOX_REVIEW_REPLY_PUBLISHED=shadow
```

Precedence: per-family var > group var > `record-only`. Values parse case-insensitively; an unrecognized non-empty value **throws at resolution** (fail-closed — a typo never silently selects a state). Nothing is set in production: every family is `record-only`.

**Boot gate (BQC-3.6 extension):** `assertJobReadiness` fails the worker boot when any family is `shadow`/`switch` while `OUTBOX_DISPATCHER_ENABLED` is not true — a switched family would otherwise silently lose its primary delivery, a shadow family its comparison delivery. When the dispatcher is enabled, the existing consumer-registration check covers the rest.

**Registration wiring:** `registerInboxHandlers` consults the flag per family; a `switch` family's `.on(...)` registrations are skipped (the calls stay in source — flag-gated retirement, and the catalogue guard discovers bus consumers statically).

## 2. Shadow-compare design

The durable consumers and the bus handlers write the **same** `inbox_items` rows, so comparing "outcomes" means comparing the resulting row state after each path processed the same event: `status`, the reply milestone fields (`first_reply_submitted_at`, `first_reply_published_at`), `source_date`, `platform`, and row existence. Content is never part of the comparison (inbox items carry none — BQC-1.2), and mismatch samples carry the eventId + diverging field **names** only (ADR 0030).

`shadow-compare.ts` is deliberately pure and **not** hooked into production code paths. The synthetic harness (the integration test) drives it explicitly: snapshot the projection after the bus run, restore the exact pre-event rows (`json_populate_recordset` rewind), run the durable path, snapshot again, compare. Results are structured `shadow.compare` logger lines + an in-memory summary — per the slice decision, **no new table**.

`review.updated` is excluded from match/mismatch collection by design: BQC-1.2 removed its bus handler (its only job was syncing denormalized copies that no longer exist), so the bus has no projection semantics for the family — the durable consumer is the only projector. The proof asserts the durable metadata refresh directly (`source_date` T1→T2) instead of manufacturing a meaningless comparison.

## 3. Synthetic proof results

All four phases ran green against the scratch DB (`repkey_bqc05_baseline`) + local Redis, twice in a row (run-to-run deterministic; org-scoped cleanup both in `beforeAll` and `afterAll`; queues unique per process and obliterated). The dispatcher processed every event through the REAL relay (`poll()` invoked directly — no sleeps) and a REAL BullMQ worker running `createDispatcherHandler` — the same wiring `worker/index.ts` performs when the flag is on.

| Phase | What ran                                                                                               | Result (exact counts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a)   | 4 synthetic facts through the real atomic command stores; bus vs durable per event                     | **3 shadow comparisons: 3 matched, 0 mismatched** (created, expired, reply.published); review.updated durable refresh asserted directly. **4 receipts** (one per consumer per event, all `applied`). Dual delivery (bus re-emit + dispatcher redelivery): **1 item, 1 receipt** — no double effects. Created facts: 2 (harness reset artifact — production dual delivery yields 1; see §4). Sync-job enqueue: **2 adds, same jobId → 1 BullMQ job** (external-effect dedup mechanism). |
| (b)   | 12 unpublished outbox rows recorded **before** the first relay poll (real atomic producer, bus silent) | **12 receipts `applied`, 12 inbox items** — each backlog event processed exactly once; redelivery of one event added nothing.                                                                                                                                                                                                                                                                                                                                                          |
| (c)   | Corruption: reopened the expired item; reopened + de-stamped the published item; deleted the live item | Dry-run report `{created: 1, closed: 2, milestones: 1, scanned: 28}` with **zero writes**; the real run healed exactly that (live item recreated open with canonical `source_date`; expired item re-closed; published item re-closed with both milestones re-stamped). Repair re-emitted **no** created fact.                                                                                                                                                                          |
| (d)   | `review.created` in `switch`: registration assertion + fact produced with no bus handlers present      | Registration excluded `review.created` (4 bus registrations remain: feedback.submitted, reply.published, reply.submitted, expired). The durable path **alone** projected the event: 1 receipt `applied`, 1 item, 1 created fact.                                                                                                                                                                                                                                                       |

**Totals:** 17 review facts processed durably (4 + 12 backlog + 1 switch-mode), 17 consumer receipts, 3/3 shadow comparisons matched, 0 double projections, 0 double external effects.

## 4. Orphan consume-or-retire (ownerSlice BQC-3.1 → resolved)

| Event family                                       | Decision | Implementation                                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity.organization.created`                    | CONSUME  | `on-organization-created.ts` → activity audit (`created`/`organization`; new `ResourceType` member, additive — varchar(50), no DB constraint)                                                                                                                                               |
| `property.updated`                                 | CONSUME  | `on-property-updated.ts` → activity audit (`changed`/`property`)                                                                                                                                                                                                                            |
| `property.deleted`                                 | CONSUME  | `on-property-deleted.ts` → activity audit (`deleted`/`property`)                                                                                                                                                                                                                            |
| `integration.google_connection.visibility_changed` | CONSUME  | `on-google-connection-visibility-changed.ts` → activity audit (`changed`/`integration`, new visibility in `to`)                                                                                                                                                                             |
| `integration.property_import.completed`            | CONSUME  | `on-property-import-completed.ts` → activity audit (`created`/`integration`, content-free counts)                                                                                                                                                                                           |
| `identity.invitation.rejected`                     | RETIRE   | Never emitted (constructor only), never schema-registered, no consumers, no value. Constructor + type removed from `identity/domain/events.ts`, exports removed from the identity public-api and the shared event union, catalogue row removed. Guard suites enforce consistency both ways. |

The five consumed families gained `activity.event-handlers` bus consumers (each enqueues `insert-activity-log` — 29 handlers now); their catalogue rows moved `orphan → enabled` and the `ownerSlice` markers are gone. `entry-point-catalogue` eventTags extended to match. Every audit line is identifier-only/content-free (ADR 0030/0045).

## 5. Rollback story (§7)

Rollback is a **flag move + reboot**, per family:

1. Set the family's var back to `record-only` (or unset). Durable consumption for the family stops being required; the outbox and any backlog are **preserved** (retention sweep owns their lifecycle, unchanged).
2. The family's bus handlers re-register on the next boot — restoring the previous authoritative consumer is safe because it cannot duplicate external effects: the only external-effect consumers (`review.event-handlers` sync-job enqueue — BullMQ jobId dedup, proven in (a); `on-google-account-disconnected` publication cancel — publication-state guarded, idempotent) are idempotent by construction, and inbox projection writes are receipt-fenced/idempotent.
3. Reconciliation before resumption: `rebuildInboxProjection` (dry-run report first, then the healing run — proven in (c)) brings the projection back to canonical state before the family serves traffic again.

## 6. What this slice did NOT do (the ACCEPTED gate)

Per the §9 exit matrix, **"Durable dispatch is safe to enable for the candidate"** is the ACCEPTED row: the production flip of `OUTBOX_DISPATCHER_ENABLED` and any `DURABLE_CUTOVER_INBOX*` value above `record-only` for the release candidate is the **user's acceptance step**, not this slice's. This slice shipped the machinery (flags, readiness gate, shadow compare, retirement wiring), the synthetic proof, and the orphan resolutions — production posture is unchanged (`record-only` everywhere, dispatcher off, bus primary).
