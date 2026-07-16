# BQR-2 — Durable Runtime (Atomic Outbox, Envelope, Consumers)

**Status:** Complete — slices 2.1–2.5 merged (#193–#197)  
**Depends on:** BQR-1 (architecture rules, public outbox surface, ADR 0030)  
**Unblocks:** BQR-3 (review lifecycle consumers), BQR-4 (selected primitives), BQR-6 (event reliability evidence)  
**Estimate:** 14–22 engineering days

## Outcome

Commands that produce domain facts commit **state + outbox row in one transaction**. The relay and dispatcher agree on a **full `ConsumerEvent` envelope**. Enabled-context consumers are **registered**, **idempotent**, and apply real projection work with **receipt + state** co-committed. Durable dispatch remains **off by default** until the full BQR-2 exit matrix is green.

## Principles (from master plan)

- One event authority per migrated event family (§3.1).
- Deep modules: callers do not know Drizzle tx types, outbox tables, or BullMQ (§3.2).
- Event changes: record-only → shadow verification → consumer switch → legacy removal (§7.2).
- One invariant or vertical slice per PR (§7.2).
- Do **not** re-enable `OUTBOX_DISPATCHER_ENABLED` until BQR-2 exit (BQR-0 residual).

## Findings closed by this phase

| Baseline finding                          | Slice that closes it                       |
| ----------------------------------------- | ------------------------------------------ |
| 1.2 Relay/dispatcher envelope mismatch    | **BQR-2.1**                                |
| 1.3 Consumer registry empty in production | **BQR-2.2**                                |
| 1.1 `emitAndRecord()` non-atomic          | **BQR-2.3+** (per event family)            |
| 1.4 No-op consumers                       | **BQR-2.4**                                |
| 4.2 Denylist-only at insert (partial)     | **BQR-2.5** (allowlist validate at insert) |

## PR slices

| Slice       | Outcome                                                                                                             | Status         |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | -------------- |
| **BQR-2.1** | Relay enqueues full `ConsumerEvent` envelope; dispatcher parses/validates envelope; unit tests lock the contract    | Done (PR #193) |
| **BQR-2.2** | Wire `registerInboxConsumers` into the worker path via `container.registerOutboxConsumers` when outbox is present   | Done (PR #194) |
| **BQR-2.3** | Tracer-bullet atomic producer: review sync `created`/`updated` via `ReviewCommandStore` (upsert + outbox in one TX) | Done (PR #195) |
| **BQR-2.4** | Real inbox durable consumers for `review.updated` / `review.expired` (no no-op `applied` receipts)                  | Done (PR #196) |
| **BQR-2.5** | Schema-registry allowlist validation at outbox insert; schema fields aligned with domain                            | Done (PR #197) |

Later slices may split by event family if a single PR would exceed review size. Dispatcher stays default-off until exit.

## BQR-2.1 scope

### In

- Pure helper that maps `UnpublishedEvent` + validated payload → `ConsumerEvent`.
- Relay `queue.add(jobName, **envelope**, { jobId: event.id })` (not bare payload).
- Dispatcher rejects/malforms-safely when job data is not a valid envelope (no silent discard of well-formed events due to `undefined` `eventType`).
- Unit tests: envelope fields present; bare-payload shape is rejected by parser.

### Out

- Enabling `OUTBOX_DISPATCHER_ENABLED` in any environment.
- Consumer registration (2.2).
- Atomic business+outbox TX (2.3).
- Implementing no-op consumer bodies (2.4).
- Allowlist-at-insert (2.5).

## Authoritative path (BQR-2.1)

| Concern           | Before                                                         | After                                                               |
| ----------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| BullMQ job `data` | Bare validated payload only                                    | Full `ConsumerEvent` envelope (ids + type/version + payload + …)    |
| Dispatcher input  | Cast `data as ConsumerEvent` → `eventType` undefined → discard | Parse envelope; validate payload via registry using envelope fields |
| Job name / job ID | `eventType` / event UUID                                       | Unchanged (dedup still by event UUID)                               |

## BQR-2.2 scope

### In

- `container.registerOutboxConsumers()` wires `registerInboxConsumers` with outbox repo, review lookup, and inbox use cases.
- Worker calls registration whenever `outboxRepo` exists (before optional relay start).
- `listRegisteredConsumers()` for diagnostics/tests.
- Architecture/unit tests prove worker + composition call sites and three inbox consumers.

### Out

- Enabling `OUTBOX_DISPATCHER_ENABLED` by default.
- Real side effects for no-op `review.updated` / `review.expired` consumers (2.4).
- Atomic producers (2.3).
- Activity/metric/notification durable consumers (later families).

## Authoritative path (BQR-2.2)

| Concern           | Before                        | After                                                         |
| ----------------- | ----------------------------- | ------------------------------------------------------------- |
| Consumer registry | Empty in production worker    | Inbox consumers registered at worker start when outbox exists |
| Dispatcher enable | Would run with zero consumers | Registry populated; still off by default until BQR-2 exit     |

## BQR-2.4 scope

### In

- `handleInboxReviewUpdated`: find inbox by source, re-fetch snippet via lookup, `syncDenormalizedFields`.
- `handleInboxReviewExpired`: find by source, close open items, emit status-changed (same as in-process handler).
- Composition wires `inboxRepo` + `events` + `clock` into consumer registration.
- Unit + architecture tests prove real side effects (no TODO no-op stubs).

### Out

- Receipt + projection in one DB transaction (applyOnce) — residual hardening.
- Enabling `OUTBOX_DISPATCHER_ENABLED` by default.
- Allowlist-at-insert (2.5).

## Exit criteria (full BQR-2)

| Criterion                                                                  | Met after 2.4? |
| -------------------------------------------------------------------------- | -------------- |
| Relay and dispatcher share one envelope contract                           | Yes (2.1)      |
| Inbox (and required) consumers registered when durable path can start      | Yes (2.2)      |
| At least one enabled producer path commits state + outbox atomically       | Yes (2.3)      |
| No enabled durable consumer acknowledges work it did not perform           | Yes (2.4)      |
| Insert path validates identifier-only payload (allowlist / registry)       | Yes            |
| Crash-boundary evidence for claim → publish → consume → receipt            | Partial\*      |
| `OUTBOX_DISPATCHER_ENABLED` remains default `false` until all of the above | Yes            |

\*Structural unit tests exist; full DB+Redis crash integration remains part of later slices / BQR-6 evidence pack.

## BQR-2.5 scope

### In

- `toOutboxEvent` allowlist-validates via schema registry; persists only Zod-parsed fields.
- `tryToOutboxEvent` skips unregistered types (no durable row for orphans).
- Denylist strip retained as defense-in-depth.
- Align review/inbox/reply schema field names with domain (`externalId`, `oldStatus`, `userId`).
- Unit tests for allowlist strip, unregistered skip, invalid payload, smuggled fields.

### Out

- Migrating remaining producers to atomic command stores (incremental).
- Enabling `OUTBOX_DISPATCHER_ENABLED` by default (BQR-2 exit decision).
- Full DB+Redis crash integration suite (BQR-6 evidence).

## Residual (accepted until later slices)

- In-process event bus still primary delivery until durable switch per family.
- Other producers still use non-atomic `emitAndRecord` (beyond review sync).
- Consumer receipt not yet co-committed with projection in one TX.
- Review content PII on in-process events is BQR-3/4 (ADR 0030 outbox path is identifier-only after adapter strip).
- Dark contexts stay dark; no new durable consumers for team/portal/goal/etc.
- Remaining event families not yet on atomic command stores.

## Containment note

Until BQR-2 exit, production/staging workers keep durable relay+dispatcher **off**. BQR-2.1 only makes the contract correct so enabling the flag later is not an automatic silent drop of every event.
