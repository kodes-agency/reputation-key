# BQR-1 — Architecture and Schema Coherence

**Status:** In progress — slice 1.1 done; 1.2 in progress  
**Depends on:** BQR-0 containment  
**Unblocks:** BQR-2 (durable runtime), BQR-4 (auth seams)  
**Estimate:** 7–11 engineering days

## Outcome

One executable architectural rule set and one canonical persistence model that match the migrated database. No dual schema truths. Domain conventions (tagged errors, context boundaries) are coherent and enforced by tests.

## Principles (from master plan)

- One canonical schema model matching the migrated database (§3.1).
- Expand → backfill/reconcile → switch → contract for DB changes (§7.2) — **no new migration that re-adds 0006–0008 objects**.
- One invariant or vertical slice per PR (§7.2).
- Evidence before status (§3.4).

## PR slices

| Slice       | Outcome                                                                                                                       | Status          |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **BQR-1.1** | Drizzle represents migrations 0006–0008; domain/mapper preserve routing + review lifecycle columns; static schema-parity test | Done (PR #189)  |
| **BQR-1.2** | Domain-error convention resolution + boundary tests (CONTEXT.md contradictions)                                               | **This branch** |
| **BQR-1.3** | Dependency-boundary / import-direction rules executable for application → outbox / infrastructure                             | Not started     |
| **BQR-1.4** | Remaining schema/doc drift (ADR 0030 gap list, health metric column consumers) without dual models                            | Not started     |

## BQR-1.2 scope

### In

- Resolve CONTEXT.md vs `shared/domain/errors.ts` contradiction (Result vs throw).
- Lifecycle assert helpers throw **tagged** context errors only (property, integration, review).
- Every context `domain/errors.ts` has factory + `isXxxError` (activity guard added).
- Architecture tests: `domain-error-convention.test.ts` (module shape + ban untagged `{ code }` throws).

### Out

- Mass-refactor of metric constructors that throw tagged errors intentionally (documented residual).
- Application use-case error unification (BQR-4 adjacent).
- Event-family / outbox import boundaries (1.3).

## BQR-1.1 scope (this slice)

### In

- `properties` columns from migration 0006 (routing / processing profile).
- `reviews` columns from migration 0006 (source lifecycle).
- Tables from migration 0007: `review_sync_state`, `review_sync_runs`, `inbound_webhook_receipts`.
- Tables from migration 0008: rollup tables + `_rollup_watermarks`.
- Export via schema barrel.
- Property + Review domain fields + mappers so selects/inserts do not silently drop columns.
- Unit architecture test: expected tables/columns present on Drizzle table objects.
- Extend migration-verification expected table list for 0007.

### Out (explicit)

- New SQL migrations re-creating 0006–0008.
- Wiring `source-content-lifecycle` into jobs (BQR-3).
- Atomic outbox / consumers (BQR-2).
- Processing-region resolver production workflow (BQR-3).
- Making `authorize()` authoritative (BQR-4).

## Authoritative path (BQR-1.1)

| Concern                          | Before                      | After                                                                                   |
| -------------------------------- | --------------------------- | --------------------------------------------------------------------------------------- |
| DB columns/tables from 0006–0008 | Exist in migrations only    | Represented in Drizzle + domain/mapper for property/review columns                      |
| Rollup / sync tables             | Raw SQL only in jobs/health | Typed Drizzle tables available for typed queries (jobs may still use SQL until cutover) |
| Schema drift detection           | Manual audit                | Executable unit test on schema objects                                                  |

## Exit criteria (full BQR-1)

| Criterion                                                           | Met in 1.1? |
| ------------------------------------------------------------------- | ----------- |
| Canonical Drizzle model matches 0006–0008 migrated objects          | Yes         |
| Architecture/schema parity test green                               | Yes         |
| Domain error convention coherent repo-wide                          | Yes (1.2)   |
| Application cannot import shared outbox internals in forbidden ways | No (1.3)    |
| No dual models for enabled paths remaining in BQR-1 scope           | Partial     |

## Residual

- Jobs still use raw SQL for rollups; typed tables enable gradual cutover without dual persistence.
- Review lifecycle columns preserved by mapper but producers may still leave them null until BQR-3.
- ADR 0032 `portal.read` core listing still documentation drift (BQR-4 residual from BQR-0).
