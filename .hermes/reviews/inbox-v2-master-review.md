# INBOX V2 — COMPREHENSIVE CODE REVIEW (MASTER REPORT)

**Date:** 2026-05-31
**Branch:** `kodes-agency/tashkent`
**Scope:** Full inbox V2 implementation — domain, application, infrastructure, UI, routes, server functions
**Files Reviewed:** 60+ files across 4 architectural layers
**Reviewers:** 3 independent senior reviewers (domain/app, infrastructure, frontend)

---

## VERDICT: 🔴 NOT APPROVED

**50 findings total — 8 CRITICAL, 16 HIGH, 18 MEDIUM, 8 LOW**

The architecture is sound — hexagonal boundaries, event-driven design, proper separation of concerns. But the implementation has systemic problems: zero integration tests, N+1 queries pretending to be batch methods, a domain constructor that validates nothing, a status transition graph that contradicts the spec, and a component defined inside a render function. Ship this and you'll be debugging tenant data leaks and performance fires within a week.

---

## 🔴 CRITICAL (8) — Must fix before merge

### [C-1] `createInboxItem` constructor validates NOTHING

**File:** `src/contexts/inbox/domain/constructors.ts:30-55`
**Layer:** Domain

The main entity constructor blindly trusts every input. No `snippet` max length, no `platform` length, no `rating` range (1-5), no `sourceType` validation beyond TS types. Pass `snippet: "x".repeat(10_000_000)` and it says `ok(...)`. The `createInboxNote` constructor correctly validates text — so the developer knows how, just didn't bother for the primary entity.

**Standard violated:** "Constructors must validate ALL string fields with min+max length" (reputation-key skill)

---

### [C-2] Status transition graph contradicts CONTEXT.md — escalation blocked from `addressed` and `archived`

**File:** `src/contexts/inbox/domain/rules.ts:11-17`
**Layer:** Domain

CONTEXT.md says: _"Escalated: Can be escalated from any status."_ But `VALID_TRANSITIONS` omits `escalated` from `addressed` and `archived`. The test at `rules.test.ts:62-65` **explicitly tests this wrong behavior as correct** — `['addressed', 'escalated']` is in the `invalidCases` list. You wrote a test that PASSES for the WRONG behavior.

---

### [C-3] Zero integration tests — repository test files are type-checking theater

**Files:** `src/contexts/inbox/infrastructure/repositories/inbox.repository.test.ts`, `inbox-note.repository.test.ts`
**Layer:** Infrastructure

Both test files verify `typeof repo.findById === 'function'`. No database queries. No tenant isolation. The test file says _"No DB test infrastructure exists in this project"_ — **a lie**, because `setupIntegrationDb()` is used by every other context (guest, dashboard, portal, integration). Without tenant isolation tests, you have zero proof that ORG_A can't see ORG_B's inbox items.

---

### [C-4] N+1 queries in "batch" helpers — `batchReviewNames` and `batchPropertyNames`

**File:** `src/contexts/inbox/infrastructure/repositories/inbox.repository.ts:383-416`
**Layer:** Infrastructure

Functions named "batch" actually loop through IDs calling single-item lookup ports inside `Promise.all`. For a page of 50 items, that's up to **100 individual DB queries** per page load. Standard says: "N+1 queries must be prevented — batch methods from the start." The lookup ports have no batch method variants.

---

### [C-5] Redis adapter has zero error handling — any Redis failure takes down inbox

**File:** `src/contexts/inbox/infrastructure/adapters/redis-unread-counter.ts:21-42`
**Layer:** Infrastructure

Every method is a naked `await redis.*` call with no try/catch. If Redis is down, restarting, or timing out, every `getCount`, `setCount`, `increment`, `decrement` call throws an unhandled exception. The `getCount` method is called from `getUnreadCount` (a read-only operation) — Redis outage makes the entire inbox page return 500. An unread counter should degrade gracefully, not take down the request.

---

### [C-6] `ResizeHandle` component defined INSIDE render body

**File:** `src/components/inbox/inbox-page-v2.tsx:178`
**Layer:** UI

Creates a **new component function** every render. React unmounts and remounts all `<ResizeHandle />` instances on every render — causing layout thrashing in `react-resizable-panels`, losing drag state, causing flicker, and potentially resetting panel sizes. This is a React cardinal sin.

---

### [C-7] `inbox-page-v2.tsx` is 345 lines — 130% over the 150-line ESLint rule

**File:** `src/components/inbox/inbox-page-v2.tsx`
**Layer:** UI

The file defines search schema, folder→status mapping, mobile detection, state orchestration, keyboard shortcuts, three-panel layout, loading states, empty states, AND the "Load more" button. Needs extraction of schema + mapping to a separate module.

---

### [C-8] `server/inbox.ts` is 378 lines — 9 server functions with repeated boilerplate

**File:** `src/contexts/inbox/server/inbox.ts`
**Layer:** Server Functions

Nine functions crammed into one file. Each repeats the same 15-line permission check + error handling boilerplate. Should extract a `withInboxPermission` wrapper.

---

## 🟠 HIGH (16) — Fix before production

### [H-1] All use cases use `throw` instead of `Result<T,E>` (neverthrow)

**Files:** All use cases in `src/contexts/inbox/application/use-cases/`

Domain layer correctly returns `Result`, but application layer unwraps and throws. Every test uses `.rejects.toSatisfy()` instead of Result checking. The entire error handling model is schizophrenic — domain returns Results, application throws them.

### [H-2] `get-folder-counts` has ZERO test coverage

**File:** `src/contexts/inbox/application/use-cases/get-folder-counts.ts`

No `.test.ts` exists. The use case has real logic (Promise.all of 5 countByStatus calls) and NO auth gate.

### [H-3] `get-folder-counts` has NO permission check

**File:** `src/contexts/inbox/application/use-cases/get-folder-counts.ts:25-43`

Takes only `organizationId` — no `userId`, no `role`, no `can()` check. Every other read use case checks `can(role, 'inbox.read')`. Information disclosure risk.

### [H-4] `getUnreadCount` has no permission check

**File:** `src/contexts/inbox/application/use-cases/get-unread-count.ts:23-54`

Same issue — takes only `organizationId`, no auth gate at the use case level.

### [H-5] Three event handlers have zero tests

**Files:** `on-review-created.ts`, `on-review-updated.ts`, `on-feedback-submitted.ts`

Only `on-reply-published.ts` has tests. The other three are the entry points for the entire inbox feature. If they break silently, no inbox items get created.

### [H-6] `onFeedbackSubmitted` always passes `rating: null` — contradicts CONTEXT.md

**File:** `src/contexts/inbox/infrastructure/event-handlers/on-feedback-submitted.ts:24`

CONTEXT.md says: _"Rating value denormalized at creation time from linked Rating."_ The handler makes no attempt to look up the rating value.

### [H-7] Dynamic `import()` inside hot-path function

**File:** `src/contexts/inbox/infrastructure/repositories/inbox.repository.ts:408`

`batchPropertyNames` contains `const { propertyId } = await import('#/shared/domain/ids')` — a dynamic import on every paginated query. The same module is already statically imported at the top of the file.

### [H-8] `sourceId` mapper uses unsafe `as` cast instead of branded constructors

**File:** `src/contexts/inbox/infrastructure/mappers/inbox.mapper.ts:18`

`sourceId: row.sourceId as InboxItem['sourceId']` — should be `sourceType === 'review' ? reviewId(row.sourceId) : feedbackId(row.sourceId)`.

### [H-9] No TTL on Redis unread counter keys

**File:** `src/contexts/inbox/infrastructure/adapters/redis-unread-counter.ts:28`

`setCount` does `redis.set(key, count)` with no expiry. Deleted org keys persist forever.

### [H-10] `parseInt` without NaN guard in Redis `getCount`

**File:** `src/contexts/inbox/infrastructure/adapters/redis-unread-counter.ts:24`

If Redis key is non-numeric, `parseInt` returns NaN which poisons all downstream comparison logic.

### [H-11] Missing `assignedTo` index on schema

**File:** `src/shared/db/schema/inbox.schema.ts`

No index on `assignedTo` column. Filtering by assignee = full table scan.

### [H-12] Dead code: `inbox-page.tsx`, `inbox-list.tsx`, `inbox-list-panel.tsx`

**Layer:** UI

These files form a dead import chain — never reached from any route. The old `inbox-page.tsx` still has `autoMarkRead: true` (wrong behavior). Delete them.

### [H-13] Missing `useCallback` for `handleBulkDone` in `use-inbox-state.ts`

**File:** `src/components/inbox/use-inbox-state.ts:108`

Passed as prop to `InboxBulkActions` without memoization — causes unnecessary re-renders.

### [H-14] Missing `useMemo` for `selectedItem` derivation

**File:** `src/components/inbox/inbox-page-v2.tsx:112-114`

`.find()` runs on every render against the full items array.

### [H-15] Missing `useMemo` for `filters` object

**File:** `src/components/inbox/inbox-page-v2.tsx:88-96`

New object reference every render, passed to `useInboxState`.

### [H-16] Inverted `can()` logic in `getInboxItems` — property scoping is dead code

**File:** `src/contexts/inbox/application/use-cases/get-inbox-items.ts:34`

When `can()` returns true (has permission), property scoping is SKIPPED. Every real role has `inbox.read`, so the property-scoping branch only fires for `Guest` (not a real role in the system). Every logged-in user sees all inbox items regardless of property assignment.

---

## 🟡 MEDIUM (18) — Fix soon

| ID   | File                                 | Issue                                                                                                    |
| ---- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| M-1  | `domain/types.ts:48-58`              | `InboxItemDetail` has redundant `reviewerName` field (already in `InboxItem`)                            |
| M-2  | `domain/rules.test.ts`               | 164 lines — exceeds 150-line limit                                                                       |
| M-3  | `inbox/build.ts`                     | 155 lines — exceeds 150-line limit                                                                       |
| M-4  | `assign-inbox-item.ts:35,49`         | Missing `can(role, 'inbox.write')` auth gate — uses `inbox.manage` for property bypass instead           |
| M-5  | Multiple use cases                   | `as unknown as` branded ID casting instead of constructors                                               |
| M-6  | `inbox.repository.ts:143-146`        | ILIKE search doesn't escape `%` and `_` wildcards in user input                                          |
| M-7  | `inbox.repository.ts:318-378`        | `findDetailById` doesn't fetch property name (list does, detail doesn't)                                 |
| M-8  | `inbox.repository.ts:310-316`        | `syncDenormalizedFields` silently ignores missing rows — no row count check                              |
| M-9  | `inbox.schema.ts:44-45`              | No DB trigger for `updatedAt` — relies solely on application layer                                       |
| M-10 | `redis-unread-counter.test.ts`       | No tests for connection failure scenarios                                                                |
| M-11 | `inbox-filters.tsx:47`               | Missing `useCallback` on `update` function passed to children                                            |
| M-12 | `inbox-list-v2.tsx`                  | `ListItemRow` not memoized — 50 items re-render on every parent render                                   |
| M-13 | `inbox-list-v2.tsx:99-100`           | `allSelected` uses O(n²) `includes()` instead of Set                                                     |
| M-14 | `inbox-notes-thread.tsx:68-70`       | `sortedNotes` creates new array + sorts every render — no `useMemo`                                      |
| M-15 | `inbox-unread-badge.tsx`             | Missing orgId in load trigger — won't refetch on org change                                              |
| M-16 | `server/inbox.ts:364-368`            | `getInboxFolderCountsFn` wraps response in `{ data: {} }` — inconsistent with all other server functions |
| M-17 | `inbox.mapper.ts:36-50`              | `toInsertRow` uses `as string` instead of `unbrand()` — inconsistent with other mappers                  |
| M-18 | `inbox-detail-source-content.tsx:19` | `<img>` without `onError` fallback for broken profile photo URLs                                         |

---

## 🔵 LOW (8) — Polish

| ID  | Issue                                                                                        |
| --- | -------------------------------------------------------------------------------------------- |
| L-1 | Cursor pagination tuple comparison needs explanatory comment (`inbox.repository.ts:150-154`) |
| L-2 | `INBOX_PAGE_SIZE` exported from component file — should be in shared constants               |
| L-3 | `Intl.DateTimeFormat` created per call in utils — should cache                               |
| L-4 | `InboxStatusBadge` — `className` merged without `cn()` utility                               |
| L-5 | `inbox-sidebar.tsx` at exactly 150 lines — needs breathing room                              |
| L-6 | `property-filter-select.tsx` returns null for 0 properties — should show disabled state      |
| L-7 | `getStatusActions` creates new JSX objects per call in `inbox-detail-helpers.tsx`            |
| L-8 | Missing `role="listbox"` + `aria-activedescendant` on `InboxListV2` for accessibility        |

---

## POSITIVE NOTES (what's done right)

1. **Architecture boundaries** are solid — hexagonal ports/adapters, proper separation of concerns
2. **Domain types** use `Readonly<>` consistently, framework-agnostic
3. **Error design** with tagged `_tag` field and `isInboxError` type guard is pattern-matchable
4. **Event constructors** follow past-tense naming convention
5. **Cross-context communication** uses public-api correctly — no direct domain imports
6. **Mapper design** is bidirectional and clean
7. **Schema indexing** aligns with query patterns, `uniqueIndex` prevents duplicates
8. **Cursor-based pagination** using keyset/tuple comparison is correct
9. **Event handlers** wrap in try/catch and don't throw — correct pattern
10. **Lua decrement-with-floor script** prevents negative counters without race conditions
11. **Server functions** all use `.inputValidator()` (not `.validator()`)
12. **No domain imports in components** — all use `public-api`
13. **Scroll isolation chain** is correct across all three panels
14. **Detail header** shows property name + platform + status (not reviewer name)
15. **List-detail sync** only updates changed fields (`status`, `updatedAt`)
16. **No auto-mark-read** in v2 — explicit only
17. **CONTEXT.md** is exemplary — detailed, authoritative, with deviations flagged

---

## TEST COVERAGE SUMMARY

| Area                            | Test Files | Assertions | Gaps                                                 |
| ------------------------------- | ---------- | ---------- | ---------------------------------------------------- |
| Domain (constructors, rules)    | 3          | ~76        | Missing negative input tests for createInboxItem     |
| Application use cases           | 9/10       | ~101       | `get-folder-counts` has ZERO tests                   |
| Infrastructure (repos)          | 2          | ~0 real    | Both are type-checking theater, no integration tests |
| Infrastructure (mappers)        | 2          | ~42        | Reasonable                                           |
| Infrastructure (adapters)       | 1          | ~15        | No failure scenario tests                            |
| Infrastructure (event handlers) | 1/4        | ~20        | Three handlers untested                              |
| **TOTAL**                       | **18**     | **~254**   | **Major gaps in repo & handler coverage**            |

---

## PRIORITY FIX ORDER

| Priority                          | Finding IDs                 | Effort | Impact                                       |
| --------------------------------- | --------------------------- | ------ | -------------------------------------------- |
| **P0 — Block merge**              | C-1, C-2, C-3, C-5, H-16    | 8h     | Domain integrity, tenant safety, data leaks  |
| **P1 — Before production**        | C-4, C-6, C-7, C-8, H-1→H-8 | 16h    | Performance, error handling, spec compliance |
| **P2 — First sprint post-launch** | H-9→H-16, M-1→M-18          | 12h    | Polish, consistency, resilience              |
| **P3 — Backlog**                  | L-1→L-8                     | 3h     | Nits                                         |

---

_Three independent reviewers. 60+ files. 50 findings. Fix the P0s first, then we talk._
