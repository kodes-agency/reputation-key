# BQC-3 — Durable Commands, Consumers, and Jobs

**Status:** `not_started`  
**Estimate:** 12–18 engineering days  
**Dependencies:** BQC-0; BQC-1 lifecycle contracts; BQC-2 policy interface  
**Unlocks:** durable dispatch, BQC-4 execution routing, reliable beta workflows

## 1. Outcome

Every enabled domain fact is durably recorded with its state in one transaction. Every enabled projection applies its state and idempotency receipt in one transaction. Jobs fail, retry, quarantine, reconcile, and redrive according to explicit policy rather than catch/log/return behavior.

The shared runtime delivers envelopes and mechanics. Owning contexts hide transactions and invariants behind deep command/projection interfaces.

## 2. Findings owned

- STD-P0-02 — projection/receipt non-atomic.
- STD-P1-01 — application imports shared outbox infrastructure.
- SPEC-P0-01 — durable runtime stopped at tracer bullet.
- SPEC-P1-02 — silent job acknowledgement.
- Durable portions of STD-P1-03 and SPEC-P0-02.

## 3. Target modules

### Context command module

One command method represents one domain operation. Its PostgreSQL adapter hides:

- aggregate load/version check;
- invariant evaluation;
- state mutation;
- registered identifier-only outbox insertion;
- transaction commit;
- post-commit in-process notification where still required during cutover.

Application code never receives an outbox repository or transaction object.

### Context projection module

An `applyOnce(event)`-style interface hides projection state, event ordering policy, idempotency receipt, repair metadata, and their transaction. Replaying the same envelope returns an observable duplicate outcome without repeating effects.

### `JobRuntime`

The runtime owns job registration, schema parsing, policy re-check hook, attempts/backoff, timeout, heartbeat, progress, retry taxonomy, quarantine/dead-letter, telemetry, and redrive. Unknown job names are configuration failures, never success.

## 4. Runtime contracts

### Failure taxonomy

| Outcome                             | Worker behavior               | Persistence/operations                                   |
| ----------------------------------- | ----------------------------- | -------------------------------------------------------- |
| Success                             | Resolve                       | Completion metric and result metadata                    |
| Idempotent duplicate                | Resolve                       | Existing receipt/reference                               |
| Policy denied/revoked               | Terminal typed state          | Content-free reason; no side effect                      |
| Invalid envelope/schema             | Unrecoverable/quarantine      | Payload fingerprint/schema version; no protected content |
| Unknown job/consumer                | Fail readiness and quarantine | Deployment/config alert                                  |
| Transient DB/Redis/provider         | Throw/reject                  | Attempts/backoff, age alert                              |
| Ambiguous external outcome          | Stop automatic repeat         | Reconciliation workflow/operator visibility              |
| Invariant/terminal domain rejection | Terminal typed state          | Stable domain code and evidence                          |

BullMQ retries require the processor to throw/reject. Catching is allowed only to add context before rethrowing or to convert to an explicit terminal/quarantine result.

## 5. Slices

### BQC-3.1 — Inventory and register enabled event/job families

- Catalogue producer, state owner, schema/version, consumer, projection owner, ordering, idempotency key, retry policy, capability/action, region, retention, and repair command.
- Mark dark-context events/jobs as denied/unregistered.
- Fail build/readiness when an enabled registered producer lacks a consumer or job handler.

### BQC-3.2 — Deepen the review/reply command family

Complete the existing tracer bullet:

- sync create/update and stable refresh;
- expiry/tombstone/purge facts;
- draft/update/approve/reject operations;
- manual publish request and publication result;
- ambiguous publication reconciliation;
- disconnect/source lifecycle commands.

All state+outbox writes are atomic. Identifier-only payload schemas are insertion-time allowlists. Remove `emitAndRecord` from migrated application paths.

### BQC-3.3 — Deepen inbox projections and commands

- Projection `applyOnce` co-commits inbox state and receipt.
- Review created/updated/expired/publication facts use real projection behavior.
- Inbox triage, assignment, notes, escalation, and resolution commands use context command stores if they emit facts.
- Notes remain context-owned content; events carry note ID, not text.
- Add repair/rebuild from canonical governed data and content-free event facts.

### BQC-3.4 — Migrate remaining enabled families

Recommended order:

1. Identity/member/invitation state needed by beta.
2. Property lifecycle and Integration OAuth/import/sync/webhook state.
3. In-app Notification and privacy-filtered Activity.
4. Metric and limited Dashboard projections.
5. Minimal Staff participation.

For each family: characterize → atomic command → durable consumer → shadow compare → authoritative switch → legacy removal. Dark Team/Portal/Guest/Goal/Badge/Leaderboard/AI families remain denied and need no speculative durable implementation.

### BQC-3.5 — Correct dispatcher and unknown-work behavior

- Malformed envelopes become unrecoverable/quarantined failures.
- Missing enabled consumer is a deployment/readiness failure and alerts.
- Consumer exceptions propagate so configured attempts apply.
- Unknown worker jobs fail/quarantine.
- Per-job attempts/backoff/jitter/timeouts are explicit and tested.
- Max-attempt jobs move to a content-safe quarantine with redrive metadata.

### BQC-3.6 — Relay, lease, ordering, and retention hardening

- Prove claim/lease/renew/reclaim under multiple workers.
- Preserve event ID, aggregate identity/version, schema version, occurred/recorded time, org/property, correlation/causation, and processing region without content.
- Define ordering per aggregate/event family; do not promise global ordering.
- Correct outbox/receipt retention with valid bounded SQL and scheduled runners.
- Alert on oldest unpublished/claimed/stalled/quarantined age and count.

### BQC-3.7 — External workflow reliability

Manual Google reply publication must use a durable state machine:

- requested → authorized → sending → published;
- provider rejected/terminal;
- transient failure/retry;
- ambiguous outcome/reconciliation required;
- cancelled by policy/disconnect.

Use idempotency where Google supports it; otherwise reconcile before retrying an ambiguous publish. Never auto-publish an AI draft.

### BQC-3.8 — Durable cutover and in-process retirement

- Enable durable processing for synthetic data only.
- Compare projections/results against the legacy in-process path without duplicate external effects.
- Drain/verify backlog and repair mismatches.
- Switch durable path authoritative per family.
- Delete legacy primary event handling and application outbox imports.
- Enable durable dispatch for the release candidate only after all enabled families and runtime gates pass.

## 6. Tests

### Atomicity

- Crash before state write, after state/before outbox attempt, before commit, and after commit.
- Crash before projection, between projection/receipt attempts, before commit, and after commit.
- Verify no observable state/event or projection/receipt split.

### Delivery

- Duplicate, reorder, delayed, missing predecessor, poison, malformed, unknown, stalled, lease expiry, Redis interruption, DB interruption, and redrive.
- Multiple workers contend without double external effects.
- Max attempts and backoff match the registered policy.

### External publication

- Timeout before request, during request, and after provider success before local acknowledgement.
- Reconciliation finds already-published reply and avoids duplicate.
- Revocation/suspension between enqueue and send denies the side effect.

### Architecture

- Application code cannot import shared outbox infrastructure.
- Shared runtime cannot import context domain events/repositories.
- All enabled schemas are registered; smuggled content fields are rejected at insertion.

## 7. Migration and rollback

Use per-family record-only/shadow/switch/contract flags. Store comparison metrics and mismatch samples without content. Rollback disables new durable consumption for the affected family, preserves outbox/backlog, restores the previous authoritative consumer only if it cannot duplicate external effects, and requires reconciliation before resumption.

Never deploy producers that emit an enabled version before compatible consumers are ready. Use additive schema versions and upcasters only for content-free envelopes where necessary.

## 8. Evidence

- Event/job catalogue.
- Per-family atomicity and crash-boundary results.
- Runtime retry/quarantine/redrive report.
- External publication ambiguity rehearsal.
- Legacy-path removal/import-boundary evidence.
- Synthetic durable backlog drain and repair report.

## 9. Exit matrix

| Criterion                                                     | Required result |
| ------------------------------------------------------------- | --------------- |
| Every enabled producer commits state+outbox atomically        | Pass            |
| Every enabled consumer commits projection+receipt atomically  | Pass            |
| Application layer has no shared outbox infrastructure imports | Pass            |
| Retryable failures throw and retry                            | Pass            |
| Invalid/unknown work quarantines and alerts                   | Pass            |
| Duplicate/reorder/poison/stalled/redrive tests pass           | Pass            |
| Manual publication reconciles ambiguous outcomes              | Pass            |
| Legacy primary delivery paths are removed                     | Pass            |
| Durable dispatch is safe to enable for the candidate          | Accepted        |

## 10. Out of scope

- Kafka, microservices, workflow platforms, or a generic unit-of-work framework.
- Durable implementation for dark product contexts.
- AI jobs or provider calls.
