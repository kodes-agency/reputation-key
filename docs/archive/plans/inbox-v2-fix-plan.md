# Inbox V2 — Fix Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Remediate all review findings from the inbox v2 deep review across domain, application, infrastructure, and frontend layers.

**Architecture:** Fixes are organized into parallel streams by dependency. Foundation streams run first, then independent streams in parallel.

**Tech Stack:** TypeScript, TanStack Start, Drizzle ORM, Redis, neverthrow, React

---

## Finding Summary (50 total)

| Layer          | CRITICAL | HIGH   | MEDIUM | LOW/NIT | Total  |
| -------------- | -------- | ------ | ------ | ------- | ------ |
| Domain+App     | 2        | 5      | 5      | 1       | 14     |
| Infrastructure | 4        | 7      | 5      | 2       | 18     |
| Frontend       | 3        | 4      | 6      | 7       | 28\*   |
| **Total**      | **9**    | **16** | **16** | **10**  | **50** |

\*Some frontend findings are overlapped with infra (e.g. server file line count).

---

## Stream Organization

### Stream A: Domain Rules + Constructor Validation (P0)

**Dependencies:** None. Must land first — all downstream depends on domain correctness.

**Findings:** F-01, F-02, F-09

---

### Stream B: Permission + Auth Fixes (P0)

**Dependencies:** None. Independent of Stream A.

**Findings:** F-05, F-07, F-12, F-14

---

### Stream C: Infrastructure Safety Net (P0)

**Dependencies:** None. Independent of Streams A+B.

**Findings:** INF-003, INF-006, INF-007, INF-008, INF-009, INF-011, INF-012, INF-013, INF-014, INF-017, INF-018

---

### Stream D: Frontend Cleanup (P1)

**Dependencies:** None. Independent.

**Findings:** FE-1 (ResizeHandle), FE-4 (dead code), FE-2 (file split), FE-5-8 (useCallback/useMemo), FE-13 (memo), FE-9 (sortedNotes), FE-22 (data wrapping), FE-17 (ARIA)

---

### Stream E: Test Coverage (P1)

**Dependencies:** Streams A+B must be merged first (tests must validate new behavior).

**Findings:** F-04, INF-001, INF-004, INF-005, INF-016

---

### Stream F: Use Case throw→Result Migration (P2 — DEFERRED)

**Dependencies:** This is a massive refactor touching 9 use cases + 9 test files + server functions. High risk of cascading breakage. Recommend deferring to a separate session.

**Findings:** F-03, F-08

---

### Stream G: Schema + DB (P2)

**Dependencies:** None.

**Findings:** INF-010, INF-015

---

## Detailed Tasks

---

### Task A1: Fix escalation transitions per CONTEXT.md

**Finding:** F-02 CRITICAL
**Files:**

- Modify: `src/contexts/inbox/domain/rules.ts`
- Modify: `src/contexts/inbox/domain/rules.test.ts`

**Steps:**

1. In `rules.ts`, update `VALID_TRANSITIONS` to add `'escalated'` to `addressed` and `archived`:
   ```ts
   addressed: ['archived', 'escalated'],
   archived: ['escalated'],
   ```
2. In `rules.test.ts`, move `['addressed', 'escalated']` and `['archived', 'escalated']` from `invalidCases` to `validCases`.
3. Run: `pnpm vitest run src/contexts/inbox/domain/rules.test.ts`
4. Verify all tests pass.

---

### Task A2: Add validation to createInboxItem constructor

**Finding:** F-01 CRITICAL
**Files:**

- Modify: `src/contexts/inbox/domain/constructors.ts`
- Modify: `src/contexts/inbox/domain/constructors.test.ts`

**Steps:**

1. In `createInboxItem`, add validation before `ok()`:
   - `snippet`: if provided, max 10000 chars, trimmed
   - `platform`: if provided, max 50 chars
   - `rating`: if provided, must be 1-5
   - Return `err(inboxError('invalid_input', ...))` on failure
2. Add negative test cases: empty snippet after trim, rating 0, rating 6, platform > 50 chars.
3. Run tests, verify pass.

---

### Task A3: Remove redundant reviewerName from InboxItemDetail

**Finding:** F-09 MEDIUM
**Files:**

- Modify: `src/contexts/inbox/domain/types.ts`
- Search all consumers and update

**Steps:**

1. Remove `reviewerName` field from `InboxItemDetail` type (it's already on `InboxItem` via the `item` field).
2. Search all files referencing `detail.reviewerName` and change to `detail.item.reviewerName`.
3. Run `pnpm build` to verify.

---

### Task B1: Add permission check to get-folder-counts

**Finding:** F-05 HIGH
**Files:**

- Modify: `src/contexts/inbox/application/use-cases/get-folder-counts.ts`
- Modify: `src/contexts/inbox/application/use-cases/get-folder-counts.test.ts` (create if missing — see E1)

**Steps:**

1. Add `userId: UserId` and `role: Role` to `GetFolderCountsInput`.
2. Add `can(role, 'inbox.read')` gate at the top — return `err` if unauthorized.
3. Update `build.ts` to pass userId and role.
4. Update the server function in `server/inbox.ts` to pass these values.

---

### Task B2: Add permission check to getUnreadCount

**Finding:** F-07 HIGH
**Files:**

- Modify: `src/contexts/inbox/application/use-cases/get-unread-count.ts`
- Modify: `src/contexts/inbox/application/use-cases/get-unread-count.test.ts`

**Steps:**

1. Add `userId: UserId` and `role: Role` to input type.
2. Add `can(role, 'inbox.read')` gate.
3. Update tests: add test for unauthorized role.
4. Update `build.ts` and server function.

---

### Task B3: Fix assignInboxItem missing can('inbox.write')

**Finding:** F-12 MEDIUM
**Files:**

- Modify: `src/contexts/inbox/application/use-cases/assign-inbox-item.ts`

**Steps:**

1. Add `can(input.role, 'inbox.write')` as primary auth gate before the `validateAssignment` call.
2. Return error if unauthorized.
3. Update test to verify.

---

### Task B4: Fix inverted can() logic in getInboxItems

**Finding:** F-14 LOW → promoted to HIGH (data leak risk)
**Files:**

- Modify: `src/contexts/inbox/application/use-cases/get-inbox-items.ts`
- Modify: `src/contexts/inbox/application/use-cases/get-inbox-items.test.ts`

**Steps:**

1. Add explicit `can(role, 'inbox.read')` gate returning forbidden on failure.
2. Separate property scoping: always apply when user has limited property access, regardless of role.
3. The property scoping should use `accessiblePropertyIds` (from staff public API) independently of the can() gate.
4. Update tests: remove `'Guest' as unknown as Role` hack, test real property scoping.

---

### Task C1: Redis adapter error handling

**Finding:** INF-003 CRITICAL
**Files:**

- Modify: `src/contexts/inbox/infrastructure/adapters/redis-unread-counter.ts`

**Steps:**

1. Wrap every method in try/catch.
2. `getCount` → return 0 on failure + log warning.
3. `setCount`/`increment`/`decrement` → log error, don't throw.
4. `invalidate` → best-effort, log on failure.

---

### Task C2: Redis TTL + NaN guard

**Findings:** INF-009 HIGH, INF-011 HIGH
**Files:**

- Modify: `src/contexts/inbox/infrastructure/adapters/redis-unread-counter.ts`

**Steps:**

1. Add TTL to `setCount`: `await redis.set(key(orgId), count.toString(), 'EX', 86400)`.
2. Fix `getCount` NaN guard: `const n = parseInt(val, 10); return Number.isNaN(n) ? 0 : n`.

---

### Task C3: Remove dynamic import in batch helper

**Finding:** INF-006 HIGH
**Files:**

- Modify: `src/contexts/inbox/infrastructure/repositories/inbox.repository.ts`

**Steps:**

1. Add `propertyId` to static imports at top of file.
2. Remove the dynamic `await import('#/shared/domain/ids')` in `batchPropertyNames`.

---

### Task C4: Fix sourceId mapper branded cast

**Finding:** INF-007 HIGH
**Files:**

- Modify: `src/contexts/inbox/infrastructure/mappers/inbox.mapper.ts`

**Steps:**

1. Import `reviewId` and `feedbackId` from shared/domain/ids.
2. Change mapper:
   ```ts
   sourceId: row.sourceType === 'review'
     ? reviewId(row.sourceId)
     : feedbackId(row.sourceId),
   ```

---

### Task C5: Denormalize rating in feedback handler

**Finding:** INF-008 HIGH
**Files:**

- Modify: `src/contexts/inbox/infrastructure/event-handlers/on-feedback-submitted.ts`

**Steps:**

1. Check if the `FeedbackSubmitted` event carries a rating value.
2. If yes, pass it to the create call.
3. If no, add a lookup via feedback port or update CONTEXT.md to clarify this is deferred.

---

### Task C6: Fetch property name in findDetailById

**Finding:** INF-013 MEDIUM
**Files:**

- Modify: `src/contexts/inbox/infrastructure/repositories/inbox.repository.ts`

**Steps:**

1. Add `propertyLookup.getPropertyNameById()` call in `findDetailById`.
2. Set `item.propertyName` from the result.

---

### Task C7: ILIKE wildcard escape

**Finding:** INF-012 MEDIUM
**Files:**

- Modify: `src/contexts/inbox/infrastructure/repositories/inbox.repository.ts`

**Steps:**

1. Add escape function for ILIKE wildcards before wrapping in `%`.
2. `filters.q.replace(/%/g, '\\%').replace(/_/g, '\\_')`.

---

### Task C8: syncDenormalizedFields error handling + cursor comment

**Findings:** INF-014 MEDIUM, INF-017 LOW
**Files:**

- Modify: `src/contexts/inbox/infrastructure/repositories/inbox.repository.ts`

**Steps:**

1. Add `.returning()` to syncDenormalizedFields and log if no row matched.
2. Add comment above cursor tuple comparison explaining the keyset pagination logic.

---

### Task C9: Use unbrand() consistently in mapper

**Finding:** INF-018 LOW
**Files:**

- Modify: `src/contexts/inbox/infrastructure/mappers/inbox.mapper.ts`

**Steps:**

1. Import `unbrand` if not already.
2. Replace `as string` casts with `unbrand()` in `inboxItemToInsertRow`.

---

### Task D1: Extract ResizeHandle to module scope

**Finding:** FE-1 CRITICAL
**Files:**

- Modify: `src/components/inbox/inbox-page-v2.tsx`

**Steps:**

1. Move `ResizeHandle` definition outside `InboxPageV2` component body (to module scope).

---

### Task D2: Delete dead code

**Finding:** FE-4 MAJOR
**Files:**

- Delete: `src/components/inbox/inbox-page.tsx`
- Delete: `src/components/inbox/inbox-list.tsx`
- Delete: `src/components/inbox/inbox-list-panel.tsx`
- Modify: `src/components/inbox/index.ts` (remove InboxList export)

**Steps:**

1. Verify no imports of these files exist: `grep -r "inbox-page\|InboxList\b" src/ --include="*.tsx" --include="*.ts" | grep -v "inbox-page-v2\|inbox-list-v2\|inbox-list-header"`.
2. Delete the three files.
3. Remove `InboxList` from index.ts.

---

### Task D3: Break up inbox-page-v2.tsx

**Finding:** FE-2 CRITICAL (345 → <150 lines)
**Files:**

- Create: `src/components/inbox/inbox-search-schema.ts`
- Modify: `src/components/inbox/inbox-page-v2.tsx`

**Steps:**

1. Extract `inboxSearchSchema` and `folderToStatus` to `inbox-search-schema.ts`.
2. Extract `INBOX_PAGE_SIZE` constant to `inbox-search-schema.ts` or a shared constants file.
3. Update imports in `inbox-page-v2.tsx` and `use-inbox-state.ts`.
4. Target: inbox-page-v2.tsx under 150 lines.

---

### Task D4: Add useCallback/useMemo fixes

**Findings:** FE-5, FE-6, FE-7, FE-8, FE-13
**Files:**

- Modify: `src/components/inbox/inbox-page-v2.tsx`
- Modify: `src/components/inbox/use-inbox-state.ts`
- Modify: `src/components/inbox/inbox-filters.tsx`
- Modify: `src/components/inbox/inbox-list-v2.tsx`
- Modify: `src/components/inbox/inbox-notes-thread.tsx`

**Steps:**

1. `use-inbox-state.ts:108` — Wrap `handleBulkDone` in `useCallback` with deps `[selectedId, loadItems, closeDetail]`.
2. `inbox-page-v2.tsx:112` — Wrap `selectedItem` in `useMemo([search.itemId, items])`.
3. `inbox-page-v2.tsx:88` — Wrap `filters` in `useMemo([rest.propertyId, statusFilter, ...])`.
4. `inbox-filters.tsx:47` — Wrap `update` in `useCallback([onChange, value])`.
5. `inbox-page-v2.tsx` — Wrap `onToggleSelect`, `onSelectAll` callbacks in `useCallback`.
6. `inbox-list-v2.tsx` — Wrap `ListItemRow` in `React.memo`.
7. `inbox-notes-thread.tsx:68` — Wrap `sortedNotes` in `useMemo([notes])`.

---

### Task D5: Add ARIA listbox role + img error handling

**Findings:** FE-17, FE-28
**Files:**

- Modify: `src/components/inbox/inbox-list-v2.tsx`
- Modify: `src/components/inbox/inbox-detail-source-content.tsx`

**Steps:**

1. Add `role="listbox"` and `aria-activedescendant` to `InboxListV2` container.
2. Add `onError` handler to `<img>` in source content to show fallback avatar.

---

### Task D6: Fix inconsistent data wrapping in getInboxFolderCountsFn

**Finding:** FE-22
**Files:**

- Modify: `src/contexts/inbox/server/inbox.ts`
- Modify sidebar consumer if needed

**Steps:**

1. Make `getInboxFolderCountsFn` return the result directly (no `{ data: {} }` wrapper).
2. Update the sidebar consumer to read the result without `.data`.

---

### Task E1: Create get-folder-counts test

**Finding:** F-04 HIGH
**Files:**

- Create: `src/contexts/inbox/application/use-cases/get-folder-counts.test.ts`

**Steps:**

1. Test: happy path with counts for each status.
2. Test: zero counts (empty org).
3. Test: unauthorized role returns forbidden (after B1 lands).
4. Follow existing test patterns from other use cases.

---

### Task E2: Add event handler tests

**Finding:** INF-005 HIGH
**Files:**

- Create: `src/contexts/inbox/infrastructure/event-handlers/on-review-created.test.ts`
- Create: `src/contexts/inbox/infrastructure/event-handlers/on-review-updated.test.ts`
- Create: `src/contexts/inbox/infrastructure/event-handlers/on-feedback-submitted.test.ts`

**Steps:**

1. Follow `on-reply-published.test.ts` pattern with mock deps.
2. Test: happy path, duplicate handling, repo error resilience.

---

### Task E3: Add Redis failure tests

**Finding:** INF-016 MEDIUM
**Files:**

- Modify: `src/contexts/inbox/infrastructure/adapters/redis-unread-counter.test.ts`

**Steps:**

1. Add "failing Redis" mock that throws on every operation.
2. Verify `getCount` returns 0 instead of throwing.
3. Verify `increment`/`decrement` don't throw.

---

### Task E4: Repository integration tests (DEFERRED — requires DB infra)

**Findings:** INF-001, INF-004
**Note:** These require `setupIntegrationDb` and a running Postgres. Mark as separate phase.

---

### Task G1: Add assignedTo index

**Finding:** INF-010 HIGH
**Files:**

- Modify: `src/shared/db/schema/inbox.schema.ts`

**Steps:**

1. Add index: `index('inbox_items_org_assigned_idx').on(t.organizationId, t.assignedTo)`.

---

### Task G2: File size fixes

**Findings:** F-10, F-11, FE-3
**Files:**

- Modify: `src/contexts/inbox/domain/rules.test.ts` (split)
- Modify: `src/contexts/inbox/build.ts` (tighten)
- Modify: `src/contexts/inbox/server/inbox.ts` (extract wrapper)

**Steps:**

1. Split `rules.test.ts` into transition tests and assignment tests.
2. Tighten `build.ts` formatting.
3. Extract `withInboxPermission` wrapper from server functions to reduce boilerplate.

---

## Execution Order

```
Phase 1 (parallel): Streams A + B + C + D
  A: Domain rules + constructor validation
  B: Permission + auth fixes
  C: Infrastructure safety net
  D: Frontend cleanup

Phase 2 (after Phase 1 merges): Stream E
  Test coverage for new behavior

Phase 3 (deferred): Streams F + E4
  F: throw→Result migration (separate session)
  E4: Integration tests (requires DB setup)
```

## Verification Gate

After each stream:

1. `pnpm tsc --noEmit` — zero NEW type errors
2. `pnpm vitest run src/contexts/inbox` — all inbox tests pass
3. `pnpm build` — build succeeds
