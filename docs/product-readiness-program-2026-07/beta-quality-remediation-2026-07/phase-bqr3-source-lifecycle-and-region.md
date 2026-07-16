# BQR-3 — Source Lifecycle and Property Region Routing

**Status:** In progress — slice 3.1  
**Depends on:** BQR-2 review slice (atomic producer, durable consumers registered, envelope contract)  
**Unblocks:** BQR-5 (review user paths stable), BQR-7 pilot gate (source policy + region), Phase 17 AI eligibility  
**Estimate:** 10–16 engineering days

## Outcome

Every successful Google review fetch **writes** policy-correct lifecycle fields (`last_fetched_at`, `content_expires_at`, `content_hash`). Refresh and purge jobs **read** the fetch-based clock, not publication time. Expired raw content is closed/scrubbed in inbox projections. Every active property has a resolvable processing region with no silent cross-region fallback.

Durable outbox dispatch remains **default-off** until an explicit BQR-2 exit decision (not part of BQR-3).

## Principles (from master plan + ADR 0031)

- Raw Google content is a **cache**: only a successful authorized re-fetch may extend the clock.
- `content_expires_at` is calculated from **last successful fetch**, never from `reviewedAt` / publication time (ADR 0031 supersedes ADR 0003).
- Unchanged content (same `content_hash`) may extend fetch/expiry timestamps without emitting `review.updated`.
- Processing region is property-owned, provider-neutral (`us` | `europe` | `global` | `unresolved`); no silent fallback.
- One invariant or vertical slice per PR (§7.2).

## Findings closed by this phase

| Baseline finding                                               | Slice that closes it |
| -------------------------------------------------------------- | -------------------- |
| 3.2 Review lifecycle columns never fully written (expiry/hash) | **BQR-3.1**          |
| 3.3 `source-content-lifecycle.ts` is dead code                 | **BQR-3.1–3.2**      |
| 4.3 inbox retains full review text after source expiry         | **BQR-3.3**          |
| Dual expiry clocks (`expiresAt` vs `contentExpiresAt`)         | **BQR-3.2**          |
| Processing region resolver not production-wired                | **BQR-3.5**          |
| Unchanged-refresh still emits `review.updated`                 | **BQR-3.4**          |

Finding 4.1 (PII on in-process domain events) may be partially mitigated in 3.4 and finished in BQR-4.

## PR slices

| Slice       | Outcome                                                                                                        | Status          |
| ----------- | -------------------------------------------------------------------------------------------------------------- | --------------- |
| **BQR-3.1** | Sync / `buildReview` always set `contentExpiresAt` + `contentHash` from policy; lifecycle module used on write | **This branch** |
| **BQR-3.2** | Refresh + purge jobs use `contentExpiresAt` / lifecycle classification; policy windows replace magic numbers   | Pending         |
| **BQR-3.3** | On `review.expired`, scrub inbox denormalized raw content (snippet / reviewer name) while closing the item     | Pending         |
| **BQR-3.4** | Hash-stable re-fetch: extend lifecycle only; no `review.updated` when content hash unchanged                   | Pending         |
| **BQR-3.5** | Property create/import resolves processing region; unresolved stays explicit; no silent region change          | Pending         |

## BQR-3.1 scope

### In

- `defaultReviewLifecycle` always sets `contentExpiresAt` from `lastFetchedAt` + `SourceContentPolicy.rawContentTtlMs`.
- Pure `computeReviewContentHash` over normalized policy-controlled fields (rating, text, reviewer name, language).
- Sync path and `buildReview` write non-null lifecycle expiry + hash on every successful construction/upsert.
- Unit tests lock: create, update (refresh), and hash stability/change.

### Out

- Switching jobs from `expiresAt` to `contentExpiresAt` (3.2).
- Inbox snippet scrub (3.3).
- Suppressing `review.updated` on unchanged hash (3.4).
- Processing-region production workflow (3.5).
- Enabling `OUTBOX_DISPATCHER_ENABLED`.
- Dropping legacy `expiresAt` column (later contract phase).

## Authoritative path (BQR-3.1)

| Concern              | Before                                                  | After                                                                 |
| -------------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| `content_expires_at` | Always null (preserved from existing; never calculated) | Set on every successful fetch = `last_fetched_at` + 30-day policy TTL |
| `content_hash`       | Always null                                             | SHA-256 of normalized rating/text/reviewerName/languageCode           |
| Lifecycle module     | Unit-tested only                                        | Used by domain lifecycle defaults + application sync write path       |
| Jobs / purge clock   | Still `expiresAt` (publication-based)                   | Unchanged this slice; switched in 3.2                                 |

## Exit criteria (full BQR-3)

| Criterion                                                             | Met after 3.1? |
| --------------------------------------------------------------------- | -------------- |
| Every successful sync writes `last_fetched_at` + `content_expires_at` | Yes            |
| Content hash written and stable for identical source content          | Yes            |
| Refresh/purge jobs use fetch-based `content_expires_at`               | No (3.2)       |
| Expired source content not retained as raw text in inbox projections  | No (3.3)       |
| Unchanged re-fetch does not emit content-changed events               | No (3.4)       |
| Active properties resolve region without silent fallback              | No (3.5)       |
| `OUTBOX_DISPATCHER_ENABLED` remains default false                     | Yes            |

## Residual (accepted until later slices / phases)

- Legacy `expiresAt` (publication clock) remains until 3.2 switches readers and a later contract drop.
- In-process events may still carry reviewer/text fields until BQR-4 identifier-only bus work.
- Full deletion coordinator (`contexts/lifecycle/`) remains PRE17B/BQR-6 scale — BQR-3 covers review+inbox vertical path.
- Time-zone API import enrichment is optional for 3.5 if country is already known; unresolved stays fail-closed for AI only.
