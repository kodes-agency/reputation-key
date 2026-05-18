# Phase 11 — Inbox Implementation Plan

> **Source docs:** ADR 0004, `src/contexts/inbox/CONTEXT.md`, `docs/plan/phase-11-inbox-spec.md`
> **Convention skill:** `reputation-key`
> **Execution:** subagent-driven-development (2-stage review per task)

## Architecture Overview

```
review.created ──→ event handler ──→ inbox_items row
feedback.submitted ──→ event handler ──→ inbox_items row
review.updated ──→ event handler ──→ sync denormalized cols

inbox context:
  domain/     types, rules (status graph), constructors, events, errors
  application/ ports (repo, note repo, unread counter), DTOs, 7 use cases
  infrastructure/ Drizzle repos, mappers, Redis adapter, 3 event handlers
  server/     7 server functions
  build.ts    factory

frontend:
  routes/_authenticated/inbox.tsx + inbox/index.tsx
  components/features/inbox/  (7 components)
```

## Task Breakdown

Tasks are ordered by dependency. Each task is self-contained — the subagent receives full context.

---

### Task 1: Schema — inbox_items and inbox_notes tables

**Files:**
- `src/shared/db/schema/inbox.schema.ts` (new)
- `src/shared/db/schema/index.ts` (modify — add export)
- `src/shared/domain/ids.ts` (modify — add `InboxItemId`, `InboxNoteId` branded types + constructors)

**Spec:**

`inbox_items` table:
```
id               uuid PK defaultRandom
organizationId   varchar(255) not null
propertyId       varchar(255) not null
sourceType       pgEnum('inbox_source_type', ['review', 'feedback']) not null
sourceId         uuid not null
status           pgEnum('inbox_status', ['new', 'read', 'addressed', 'escalated', 'archived']) not null default 'new'
rating           integer nullable
sourceDate       timestamp not null
platform         varchar(255) nullable
snippet          text nullable
assignedTo       varchar(255) nullable
readAt           timestamp nullable
escalatedAt      timestamp nullable
addressedAt      timestamp nullable
archivedAt       timestamp nullable
createdAt        createdAtColumn()
updatedAt        updatedAtColumn()
```

Indexes:
- `inbox_items_org_status_idx` on `(organizationId, status)`
- `inbox_items_org_source_date_idx` on `(organizationId, sourceDate DESC, id)`
- `inbox_items_property_idx` on `(propertyId)`
- `inbox_items_source_unique` UNIQUE on `(sourceType, sourceId, organizationId)`

`inbox_notes` table:
```
id               uuid PK defaultRandom
inboxItemId      uuid FK → inbox_items.id ON DELETE CASCADE not null
organizationId   varchar(255) not null
authorUserId     varchar(255) not null
text             text not null
createdAt        createdAtColumn()
```

Index: `inbox_notes_item_idx` on `(inboxItemId)`

**Conventions:** Follow `review.schema.ts` patterns. Use `createdAtColumn()` / `updatedAtColumn()` from `shared/db/columns`. Unique index includes `organizationId` (tenant isolation — see reputation-key pitfall).

---

### Task 2: Domain types + errors

**Files:**
- `src/contexts/inbox/domain/types.ts` (new)
- `src/contexts/inbox/domain/errors.ts` (new)
- `src/contexts/inbox/CONTEXT.md` (already exists — no changes)

**Spec:**

`types.ts`:
- `InboxStatus` = `'new' | 'read' | 'addressed' | 'escalated' | 'archived'`
- `SourceType` = `'review' | 'feedback'`
- `InboxItem` — readonly type with branded IDs, all fields from schema spec
- `InboxNote` — readonly type
- `InboxItemDetail` = `InboxItem` + optional joined source data (review text, reviewer name, feedback comment)

`errors.ts`:
- Tagged error shape `{ _tag: 'InboxError', code, message, context? }`
- Closed error code union: `'invalid_transition' | 'forbidden' | 'not_found' | 'assignment_not_allowed' | 'already_exists' | 'bulk_partial_failure'`
- `inboxError(code, message, context?)` constructor
- `isInboxError(e)` type guard
- Error status mapping function for server layer

**Conventions:** `readonly` on all fields. `Result<T, E>` from neverthrow in rules/constructors. No `class`, no `enum`, no `throw` in domain.

---

### Task 3: Domain rules + tests (status transition graph)

**Files:**
- `src/contexts/inbox/domain/rules.ts` (new)
- `src/contexts/inbox/domain/rules.test.ts` (new)

**Spec:**

`rules.ts` — pure functions, no async, no I/O:

1. `canTransition(from: InboxStatus, to: InboxStatus): boolean`
   - Valid transitions (from spec):
     ```
     new → read, archived, escalated
     read → addressed, escalated
     escalated → addressed, archived
     addressed → archived
     archived → read
     ```
2. `validateTransition(from, to): Result<InboxStatus, InboxError>` — returns Ok or Err with `invalid_transition`
3. `canAssign(role: Role): boolean` — true for `PropertyManager`, `AccountAdmin` only
4. `validateAssignment(role: Role): Result<true, InboxError>` — Err with `assignment_not_allowed`

**Tests:** All valid transitions tested. All invalid transitions tested (returns Err). Assignment: PM passes, AccountAdmin passes, Staff fails. Boundary cases: same-status transition fails.

---

### Task 4: Domain constructors + events

**Files:**
- `src/contexts/inbox/domain/constructors.ts` (new)
- `src/contexts/inbox/domain/constructors.test.ts` (new)
- `src/contexts/inbox/domain/events.ts` (new)
- `src/shared/events/events.ts` (modify — add inbox event exports)
- `src/contexts/inbox/application/public-api.ts` (new)

**Spec:**

`constructors.ts`:
- `createInboxItem(input)` → `Result<InboxItem, InboxError>` — validates required fields, generates id/timestamps
- `createInboxNote(input)` → `Result<InboxNote, InboxError>` — validates text non-empty

`events.ts`:
- `InboxItemCreated` = `{ _tag: 'inbox.item.created', inboxItemId, organizationId, propertyId, sourceType, sourceId, occurredAt }`
- `InboxStatusChanged` = `{ _tag: 'inbox.status.changed', inboxItemId, organizationId, oldStatus, newStatus, occurredAt }`
- `InboxItemAssigned` = `{ _tag: 'inbox.item.assigned', inboxItemId, organizationId, assignedTo, occurredAt }`
- Constructors for each
- `InboxEvent` union

`public-api.ts`:
- Re-exports `InboxItem`, `InboxNote`, `InboxStatus`, `SourceType` types for component consumption (ESLint boundary compliance)

**Tests:** Constructor happy paths, empty text rejection, missing fields. Event structure validation.

---

### Task 5: Application ports + DTOs

**Files:**
- `src/contexts/inbox/application/ports/inbox.repository.ts` (new)
- `src/contexts/inbox/application/ports/inbox-note.repository.ts` (new)
- `src/contexts/inbox/application/ports/unread-counter.port.ts` (new)
- `src/contexts/inbox/application/dto/inbox.dto.ts` (new)

**Spec:**

`inbox.repository.ts` — TypeScript interface:
- `findById(id, orgId): Promise<InboxItem | null>`
- `findBySource(sourceType, sourceId, orgId): Promise<InboxItem | null>`
- `findFilteredPaginated(filters, orgId, cursor?, limit?): Promise<{ items: ReadonlyArray<InboxItem>, nextCursor: Cursor | null }>`
- `create(item): Promise<InboxItem>`
- `updateStatus(id, orgId, status, timestampFields): Promise<InboxItem>`
- `bulkUpdateStatus(ids, orgId, status, timestampFields): Promise<{ updated: number }>`
- `updateAssignment(id, orgId, assignedTo): Promise<InboxItem>`
- `countByStatus(orgId, status): Promise<number>`
- `syncDenormalizedFields(id, orgId, fields): Promise<void>`

`inbox-note.repository.ts`:
- `findByInboxItemId(inboxItemId, orgId): Promise<ReadonlyArray<InboxNote>>`
- `create(note): Promise<InboxNote>`

`unread-counter.port.ts`:
- `getCount(orgId, userId): Promise<number>`
- `setCount(orgId, userId, count): Promise<void>`
- `increment(orgId, userId): Promise<void>`
- `decrement(orgId, userId): Promise<void>`
- `invalidate(orgId, userId): Promise<void>`

`inbox.dto.ts` — Zod schemas:
- `getInboxItemsDto` — `{ propertyId?, status?, sourceType?, platform?, ratingMin?, ratingMax?, sourceDateFrom?, sourceDateTo?, cursor?, limit? }`
- `updateStatusDto` — `{ inboxItemId, status }`
- `bulkUpdateStatusDto` — `{ inboxItemIds: uuid[], status }`
- `assignInboxItemDto` — `{ inboxItemId, assignedToUserId }`
- `addInboxNoteDto` — `{ inboxItemId, text }`

---

### Task 6: Use cases (7 total) + tests

**Files (all new):**
- `src/contexts/inbox/application/use-cases/get-inbox-items.ts` + `.test.ts`
- `src/contexts/inbox/application/use-cases/get-inbox-item-detail.ts` + `.test.ts`
- `src/contexts/inbox/application/use-cases/update-inbox-status.ts` + `.test.ts`
- `src/contexts/inbox/application/use-cases/bulk-update-status.ts` + `.test.ts`
- `src/contexts/inbox/application/use-cases/assign-inbox-item.ts` + `.test.ts`
- `src/contexts/inbox/application/use-cases/add-inbox-note.ts` + `.test.ts`
- `src/contexts/inbox/application/use-cases/get-unread-count.ts` + `.test.ts`
- `src/shared/testing/in-memory-inbox-repo.ts` (new)
- `src/shared/testing/in-memory-inbox-note-repo.ts` (new)

**Spec:**

Each use case follows the 7-step pattern (authorize → load refs → check invariants → build → persist → emit → return).

Factory pattern: `(deps) => async (input, ctx) => Promise<T>`

Deps include: repos, event bus, clock, idGen.

Tests use in-memory repos + capturing event bus. Every use case tested for: authz rejection, validation error, happy path persistence, event emission.

`get-inbox-items`: Auth required (any authenticated role). Returns paginated filtered list. Cursor-based on `(sourceDate DESC, id)`.

`get-inbox-item-detail`: Auth required. Loads inbox item + JOINed source data (review or feedback). Returns `InboxItemDetail`.

`update-inbox-status`: Auth required. Validates transition via `canTransition`. Updates status + relevant timestamp field. Emits `inbox.status.changed`. Decrements/increments unread counter.

`bulk-update-status`: PM+ only. Best-effort — iterates items, catches per-item errors, returns `{ succeeded, failed }`. Emits event per successful item.

`assign-inbox-item`: PM+ only. Validates role via `canAssign`. Optionally validates assignee has property access (port method on staff repo). Emits `inbox.item.assigned`.

`add-inbox-note`: Auth required (any role). Creates note. No status change.

`get-unread-count`: Auth required. Returns cached count from Redis port. Falls back to repo count if cache miss.

---

### Task 7: Infrastructure — repositories + mappers + tests

**Files (all new):**
- `src/contexts/inbox/infrastructure/mappers/inbox.mapper.ts` + `.test.ts`
- `src/contexts/inbox/infrastructure/mappers/inbox-note.mapper.ts` + `.test.ts`
- `src/contexts/inbox/infrastructure/repositories/inbox.repository.ts` + `.test.ts`
- `src/contexts/inbox/infrastructure/repositories/inbox-note.repository.ts` + `.test.ts`
- `src/contexts/inbox/infrastructure/adapters/redis-unread-counter.ts`

**Spec:**

Mappers: `toRow(domain)` / `fromRow(db)`. Round-trip tests. Branded ID handling with `as string` cast.

`inbox.repository.ts` (Drizzle):
- All port methods implemented
- Every query includes `organizationId` filter (tenant isolation pitfall!)
- `findFilteredPaginated` builds dynamic WHERE from DTO filters, ORDER BY `(sourceDate DESC, id)`, cursor-based with `WHERE (sourceDate, id) < (cursor.sourceDate, cursor.id)`
- `bulkUpdateStatus` uses individual updates in a loop (best-effort)
- Upsert on `findBySource` uses `onConflictDoUpdate` target includes `organizationId`

`inbox-note.repository.ts` (Drizzle):
- Simple CRUD, `organizationId` on all queries

Repository integration tests (real Postgres):
- CRUD happy paths
- **Tenant isolation test** (NON-NEGOTIABLE) — org A cannot see org B's items
- Read-back verification after mutations
- `setupIntegrationDb()` for DB setup
- UUID-based test IDs (no fixed strings for unique columns)
- `pool: 'forks', singleFork: true` in describe block

`redis-unread-counter.ts`:
- Key pattern: `inbox:unread:{organizationId}:{userId}`
- `getCount`: GET → parse int, cache miss returns -1 (caller falls back to DB count)
- `setCount`: SET with 1-hour TTL
- `increment`/`decrement`: INCR/DECR
- `invalidate`: DEL

---

### Task 8: Infrastructure — event handlers

**Files (all new):**
- `src/contexts/inbox/infrastructure/event-handlers/handle-review-created.ts`
- `src/contexts/inbox/infrastructure/event-handlers/handle-feedback-submitted.ts`
- `src/contexts/inbox/infrastructure/event-handlers/handle-review-updated.ts`

**Spec:**

Each handler:
- Subscribes to the relevant domain event (`review.created`, `feedback.submitted`, `review.updated`)
- Creates/updates `inbox_items` row with denormalized filter/sort fields
- Idempotent — uses `(sourceType, sourceId, organizationId)` unique constraint with `onConflictDoUpdate`
- Does NOT throw — catches and logs errors (event handler convention)
- Logs via `getLogger()`

`handle-review-created`:
- Extracts: propertyId, organizationId, platform, rating, reviewedAt (→ sourceDate), reviewerName + text (→ snippet first 200 chars)
- Creates inbox item with `sourceType = 'review'`

`handle-feedback-submitted`:
- Extracts: propertyId, organizationId, comment (→ snippet)
- Looks up linked rating value from `ratings` table (via ratingId on feedback)
- `sourceType = 'feedback'`, `platform = null`, `sourceDate = feedback.createdAt`
- Bare ratings (no feedback) do NOT trigger this handler

`handle-review-updated`:
- Syncs denormalized fields: rating, text (snippet), reviewedAt (sourceDate)
- Uses `onConflictDoUpdate` on the unique source index

**Wiring:** These are wired in `build.ts` and subscribed in composition/bootstrap, not in this task. Just export handler factory functions.

---

### Task 9: Build function + composition wiring

**Files:**
- `src/contexts/inbox/build.ts` (new)
- `src/composition.ts` (modify — add inbox context)
- `src/contexts/inbox/server/inbox.ts` (new — but just the server functions shell for now)

**Spec:**

`build.ts`:
- Input: `{ db, events, clock, staffPublicApi, reviewRepo, guestInteractionRepo }`
- Creates repos, adapters, use cases
- Returns: `{ useCases: { ...all 7 }, inboxRepo, inboxNoteRepo, eventHandlers: { handleReviewCreated, handleFeedbackSubmitted, handleReviewUpdated } }`

`composition.ts` changes:
- Import `buildInboxContext`
- Build after `review` and `guest` contexts (dependency on their repos)
- Subscribe inbox event handlers to `review.created`, `feedback.submitted`, `review.updated`
- Expose inbox use cases in container

---

### Task 10: Server functions

**Files:**
- `src/contexts/inbox/server/inbox.ts` (new — full implementation)

**Spec:**

7 server functions, each following the pattern from `src/contexts/CONTEXT.md`:

```typescript
export const getInboxItems = createServerFn({ method: 'GET' })
  .validator(getInboxItemsDto)
  .handler(tracedHandler(async ({ data }) => {
    const ctx = await resolveTenantContext(request.headers)
    const result = await getInboxItemsUseCase(deps)({ ...data }, ctx)
    clearTenantCache()
    return match(result)
      .with({ _tag: 'Ok' }, ({ value }) => value)
      .with({ _tag: 'Err' }, ({ error }) => { throw mapError(error) })
      .exhaustive()
  }))
```

All 7 functions: `getInboxItems`, `getInboxItemDetail`, `updateInboxStatus`, `bulkUpdateStatus`, `assignInboxItem`, `addInboxNote`, `getUnreadCount`.

Error mapping uses `throwContextError` exclusively (reputation-key convention). Status mapping function from `errors.ts` maps codes to HTTP status codes.

---

### Task 11: Frontend — routes + inbox layout

**Files:**
- `src/routes/_authenticated/inbox.tsx` (new — layout route)
- `src/routes/_authenticated/inbox/index.tsx` (new — inbox page)
- `src/components/features/inbox/index.ts` (new — barrel export)

**Spec:**

`inbox.tsx` (layout route):
- `beforeLoad`: auth check (standard authenticated pattern)
- `loader`: loads initial inbox items (first page, no filters)
- Returns `{ inboxItems, nextCursor }`
- Component renders the email split layout: list on left, optional detail on right

`inbox/index.tsx`:
- Redirects to or renders the inbox page inline
- Uses `useLoaderData` from parent route for initial data
- Passes server fn hooks as props to components (convention)

---

### Task 12: Frontend — list + filter + bulk actions

**Files:**
- `src/components/features/inbox/inbox-list.tsx` (new)
- `src/components/features/inbox/inbox-item-row.tsx` (new)
- `src/components/features/inbox/inbox-filter-bar.tsx` (new)
- `src/components/features/inbox/inbox-bulk-actions.tsx` (new)

**Spec:**

`inbox-filter-bar.tsx`: Filters — property, status, source type, platform, rating range, date range. Triggers refetch via cursor-based pagination.

`inbox-list.tsx`: Scrollable list of `inbox-item-row` components. Checkbox selection for bulk actions. Cursor-based infinite scroll or "Load more" button. Props: server fn hooks for `getInboxItems`, `updateInboxStatus`, `bulkUpdateStatus`.

`inbox-item-row.tsx`: Single row showing snippet, source type icon, rating stars, platform badge, status badge, assigned-to avatar, relative date. Click opens detail panel.

`inbox-bulk-actions.tsx`: Toolbar visible when items selected. Actions: mark read, mark addressed, archive. Uses `useMutationAction` with `invalidateRoutes: ['/_authenticated/inbox']`.

**Design:** Linear dark-only theme. Colors from `src/styles.css` tokens. `rounded-[8px]` for interactive elements. Hover: `rgba(255,255,255,0.04)`.

---

### Task 13: Frontend — detail panel + notes thread

**Files:**
- `src/components/features/inbox/inbox-detail-panel.tsx` (new)
- `src/components/features/inbox/inbox-note-thread.tsx` (new)
- `src/components/features/inbox/inbox-unread-badge.tsx` (new)

**Spec:**

`inbox-detail-panel.tsx`: Right panel showing full item detail. Source content (review text + reviewer + photos, or feedback comment + rating). Status badge with transition buttons. Assignment dropdown. Action bar: escalate, archive, mark addressed. Contains the note thread below.

`inbox-note-thread.tsx`: Chat-like vertical thread. Notes sorted newest at bottom. Each note shows author name, timestamp, text. Input at bottom (textarea + submit button). Uses `useMutationAction(addInboxNote)`.

`inbox-unread-badge.tsx`: Badge component for the sidebar nav. Polls `getUnreadCount` or subscribes to real-time updates. Shows count bubble when > 0.

---

### Task 14: Sidebar integration + event handler wiring

**Files:**
- `src/components/layout/manager-sidebar.tsx` (modify — add inbox nav item with unread badge)
- `src/composition.ts` (verify event handler subscriptions)
- `src/bootstrap.ts` or worker entry (modify — register inbox event handlers if needed)

**Spec:**

- Add "Inbox" nav item to `ManagerSidebar` with `inbox-unread-badge`
- Route: `/inbox`
- Icon: inbox/mail icon from lucide-react
- Event handlers wired in composition root:
  ```ts
  eventBus.subscribe('review.created', inbox.eventHandlers.handleReviewCreated)
  eventBus.subscribe('feedback.submitted', inbox.eventHandlers.handleFeedbackSubmitted)
  eventBus.subscribe('review.updated', inbox.eventHandlers.handleReviewUpdated)
  ```

---

## Task Dependency Graph

```
Task 1 (schema + IDs)
  ↓
Task 2 (types + errors)
  ↓
Task 3 (rules + tests) — depends on Task 2
  ↓
Task 4 (constructors + events + public-api) — depends on Task 2, Task 3
  ↓
Task 5 (ports + DTOs) — depends on Task 2
  ↓
Task 6 (use cases + tests) — depends on Task 3, Task 4, Task 5
  ↓
Task 7 (repos + mappers + tests) — depends on Task 5
  ↓
Task 8 (event handlers) — depends on Task 5, Task 6
  ↓
Task 9 (build + composition) — depends on Task 6, Task 7, Task 8
  ↓
Task 10 (server functions) — depends on Task 9
  ↓
Task 11 (routes) — depends on Task 10
Task 12 (list components) — depends on Task 11 (can run parallel with 13)
Task 13 (detail components) — depends on Task 11 (can run parallel with 12)
  ↓
Task 14 (sidebar + wiring verification) — depends on Task 12, Task 13
```

## Execution Order

Tasks 1–10: **Strict sequential** (each depends on the previous).
Tasks 12 and 13: **Parallel** after Task 11 completes.
Task 14: After 12 and 13 complete.

## Gate Criteria (from spec)

- [ ] Manager sees all reviews and feedback in one list, sortable and filterable
- [ ] Status transitions enforced (invalid transitions rejected with clear error)
- [ ] Bulk actions work on multiple selected items
- [ ] Pagination handles 1000+ items with cursor-based pagination (tested)
- [ ] Tenant isolation: inbox only shows items from current organization
- [ ] Role check: Staff sees items for assigned properties; PM sees assigned properties; AccountAdmin sees all
- [ ] Assignment: PM+ only, assignee must have property access
- [ ] Internal notes save with correct author and timestamp
- [ ] Unread badge updates when items change status
- [ ] E2E test: login → see inbox → filter to 2-star reviews → mark read → escalate another → add note → verify badge

## Critical Pitfalls (from reputation-key skill)

1. **Unique index must include `organizationId`** on `inbox_items` — prevents cross-tenant collision on `(sourceType, sourceId)`
2. **Every repo query filters by `organizationId`** — even lookups by unique IDs
3. **Delete/update methods include `organizationId`** — not just reads
4. **Upsert uses `onConflictDoUpdate` with `updatedAt` in `set` clause** — never select-then-write
5. **Server fns use `throwContextError` exclusively** — never raw tagged throws
6. **Components import from `application/public-api`, not `domain/`** — ESLint boundary compliance
7. **Route loaders for initial data, `useMutationAction` with `invalidateRoutes` for mutations**
8. **`Promise.all` not `Promise.allSettled`** in loaders
9. **Integration repo tests: tenant isolation NON-NEGOTIABLE, UUID-based test IDs, read-back verification**
10. **Event handlers are idempotent, don't throw, log via shared logger**
11. **Clock injection at build/use-case level only — NOT repository level**
12. **All filenames kebab-case** (no dot-separated like `.types.ts`)
13. **No `as unknown as` except branded ID unbranding in mappers** — use `as string` instead
14. **Integration test UUIDs use valid hex chars only** (0-9, a-f)
