# BQR-3 — Source Lifecycle and Property Region Routing

**Status:** Complete — slices 3.1–3.5

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
| **BQR-3.1** | Sync / `buildReview` always set `contentExpiresAt` + `contentHash` from policy; lifecycle module used on write | Done (PR #199)  |
| **BQR-3.2** | Refresh + purge jobs use `contentExpiresAt` / lifecycle classification; policy windows replace magic numbers   | Done (this PR)  |
| **BQR-3.3** | On `review.expired`, scrub inbox denormalized raw content (snippet / reviewer name) while closing the item     | Done (this PR)  |
| **BQR-3.4** | Hash-stable re-fetch: extend lifecycle only; no `review.updated` when content hash unchanged                   | Done (this PR)  |
| **BQR-3.5** | Property create/import resolves processing region; unresolved stays explicit; no silent region change          | **This branch** |

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

## BQR-3.2 scope

### In

- Repository expiry scans query `content_expires_at` (non-null), not publication `expires_at`.
- Refresh job: policy lead window via `contentRefreshDueThreshold`; `classifyReviewsForRefresh` keeps only `refresh_due`.
- Purge job: threshold is `now` (exclusive); **no** 3-day post-expiry grace (ADR 0031).
- Unit tests lock policy windows and expired-vs-due split.

### Out

- Inbox snippet scrub (3.3).
- Hash-stable re-fetch without `review.updated` (3.4).
- Processing-region production workflow (3.5).
- Dropping legacy `expiresAt` column (later contract).
- Backfill of null `content_expires_at` rows (re-fetch via normal sync fills them).

## Authoritative path (BQR-3.2)

| Concern          | Before                                    | After                                                                   |
| ---------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| Refresh scan     | `expiresAt <= now+5d` (publication clock) | `contentExpiresAt <= now+policyLead` then classify → `refresh_due` only |
| Purge scan       | `expiresAt < now-3d` (grace)              | `contentExpiresAt < now` (no grace)                                     |
| Lifecycle module | Write path only (3.1)                     | Write + refresh job classification                                      |

## BQR-3.3 scope

### In

- In-process `onReviewExpired` and durable `handleInboxReviewExpired` clear `snippet` + `reviewerName` when source expires.
- Scrub runs even if the item is already closed (idempotent cleanup of residual copies).
- `syncDenormalizedFields` accepts `snippet: null` / `reviewerName: null` to clear columns.
- Shared `scrubInboxSourceContent` helper used by both paths.

### Out

- Removing denormalized columns entirely (later contract / PRE17B inbox expansion).
- Scrubbing rating (kept as non-text operational fact for closed history).
- Hash-stable re-fetch (3.4) or processing region (3.5).

## Authoritative path (BQR-3.3)

| Concern                 | Before                                      | After                                |
| ----------------------- | ------------------------------------------- | ------------------------------------ |
| Expiry inbox projection | Close only; snippet + reviewerName retained | Scrub to null, then close if open    |
| Already-closed item     | No-op                                       | Still scrubs denormalized raw fields |
| Durable consumer        | Close only (BQR-2.4)                        | Same scrub + close as in-process     |

## BQR-3.4 scope

### In

- On re-sync, when existing `contentHash` equals newly computed hash: `reviewRepo.upsert` only (extend `lastFetchedAt` / `contentExpiresAt`); **no** `review.updated` / outbox row.
- When hash differs or existing hash is null: keep atomic `upsertAndRecord` + `review.updated` (null hash establishes baseline once).
- `SyncReviewsResult.updated` counts content-changed emissions only.

### Out

- Renaming events to `review.content-changed.v1` (later contract).
- Processing-region production workflow (3.5).
- Identifier-only in-process event payloads (BQR-4).

## Authoritative path (BQR-3.4)

| Concern               | Before                           | After                                                  |
| --------------------- | -------------------------------- | ------------------------------------------------------ |
| Unchanged re-fetch    | Always `review.updated` + outbox | Lifecycle clocks only; zero domain events              |
| Content-changed fetch | `review.updated`                 | Unchanged (still atomic upsert + event)                |
| Null existing hash    | N/A                              | Treated as content-changed once to write baseline hash |

## BQR-3.5 scope

### In

- Pure `resolvePropertyRouting` / `wouldChangeResolvedRegion` using shared `resolveRegion`.
- Create + `buildProperty` optional `countryCode` → resolved region + provenance.
- GBP import threads `storefrontAddress.regionCode` → property routing (`google_address`).
- Update may set country when unresolved or same-region; **rejects** cross-region change (`region_locked`).
- Unresolved stays explicit when country is absent (no silent `us`/`global` default).

### Out

- Google Time Zone API enrichment (timezone may remain UTC / legacy until later).
- Organization/contract region overrides UI.
- ProcessingCapabilityRegistry cell deployment matrix (Phase 17).
- Fleet backfill job for historical unresolved rows (manual re-save / re-import).

## Authoritative path (BQR-3.5)

| Concern                    | Before                     | After                                                                |
| -------------------------- | -------------------------- | -------------------------------------------------------------------- |
| Create without country     | Always unresolved defaults | Unchanged — explicit unresolved                                      |
| Create/import with country | Region columns ignored     | `resolveRegion` + resolvedAt + country_default provenance            |
| Update country             | Not supported              | Allowed if unresolved or same region; blocked if region would change |
| Silent fallback            | N/A                        | Forbidden — `region_locked` on cross-region attempts                 |

## Exit criteria (full BQR-3)

| Criterion                                                             | Met after 3.5? |
| --------------------------------------------------------------------- | -------------- |
| Every successful sync writes `last_fetched_at` + `content_expires_at` | Yes (3.1)      |
| Content hash written and stable for identical source content          | Yes (3.1)      |
| Refresh/purge jobs use fetch-based `content_expires_at`               | Yes (3.2)      |
| Expired source content not retained as raw text in inbox projections  | Yes (3.3)      |
| Unchanged re-fetch does not emit content-changed events               | Yes (3.4)      |
| Active properties resolve region without silent fallback              | Yes            |
| `OUTBOX_DISPATCHER_ENABLED` remains default false                     | Yes            |

## Residual (accepted until later phases)

- Legacy `expiresAt` (publication clock) remains until a later contract drop; jobs no longer read it.
- In-process events may still carry reviewer/text fields until BQR-4 identifier-only bus work.
- Full deletion coordinator (`contexts/lifecycle/`) remains PRE17B/BQR-6 scale.
- Time-zone API import enrichment remains optional; UTC/legacy timezone fails closed for AI only.
