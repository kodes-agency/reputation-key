# Activity Context Backend — Implementation Plan

> **For Hermes:** Use TDD skill to implement this plan task-by-task with vertical red-green-refactor slices.

**Goal:** Implement the `src/contexts/activity/` backend — a new bounded context that records an immutable audit log of org-wide human actions via event subscription.

**Architecture:** Pure subscriber context. No commands, no use cases, no direct writes. Domain events from other contexts flow in via BullMQ jobs, activity entries flow out via queries. Action grammar payload format. Mirrors existing metric context's subscriber pattern.

**Tech Stack:** TypeScript, Drizzle ORM, BullMQ, Vitest, PostgreSQL, Zod

**Decisions reference:** `src/contexts/inbox/CONTEXT.md` lines 157–163 (Q11–Q16)

---

## Phase 1: New Domain Events

6 events don't exist yet. Create them before the activity context can subscribe.

### Task 1.1: Add `inbox.note.added` event type

**Objective:** New event emitted when a note is added to an inbox item.

**Files:**

- Modify: `src/contexts/inbox/domain/events.ts`
- Modify: `src/contexts/inbox/application/use-cases/add-inbox-note.ts`
- Modify: `src/contexts/inbox/application/use-cases/add-inbox-note.test.ts`
- Modify: `src/shared/events/events.ts`

**Step 1: Write failing test**

In `add-inbox-note.test.ts`, add test:

```typescript
it('emits inbox.note.added event', async () => {
  const { deps, useCase } = setup()
  await deps.repo.create(seedItem())

  await useCase({
    inboxItemId: ITEM_ID,
    organizationId: ORG_ID,
    authorUserId: USER_ID,
    text: 'Please check this',
    role: 'AccountAdmin' as Role,
  })

  expect(deps.events.captured).toHaveLength(1)
  expect(deps.events.captured[0]._tag).toBe('inbox.note.added')
})
```

But first, `add-inbox-note` deps need an `events: EventBus` field. Add it to `AddInboxNoteDeps`.

**Step 2: Run test — FAIL** (no `inbox.note.added` type, no emit in use case)

**Step 3: Add event type to `src/contexts/inbox/domain/events.ts`**

```typescript
export type InboxNoteAdded = Readonly<{
  _tag: 'inbox.note.added'
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  authorUserId: UserId
  noteId: InboxNoteId
  text: string
  occurredAt: Date
}>

export const inboxNoteAdded = (args: Omit<InboxNoteAdded, '_tag'>): InboxNoteAdded => ({
  _tag: 'inbox.note.added',
  ...args,
})
```

Add to `InboxEvent` union.

**Step 4: Add `events: EventBus` to `AddInboxNoteDeps`, emit in use case after persist**

**Step 5: Export new type in `src/shared/events/events.ts`**

**Step 6: Run test — PASS**

**Step 7: Commit** — `feat(inbox): emit inbox.note.added event`

---

### Task 1.2: Add `inbox.item.unassigned` event type

**Objective:** Event emitted when `assignedTo` is cleared (set to null).

**Files:**

- Modify: `src/contexts/inbox/domain/events.ts`
- Modify: `src/contexts/inbox/application/use-cases/assign-inbox-item.ts`
- Modify: `src/contexts/inbox/application/use-cases/assign-inbox-item.test.ts`
- Modify: `src/shared/events/events.ts`

**Step 1: Write failing test**

```typescript
it('emits inbox.item.unassigned event when clearing assignment', async () => {
  const { deps, useCase } = setup(seededWithAssignment)
  await useCase({
    inboxItemId: ITEM_ID,
    organizationId: ORG_ID,
    assignedToUserId: null,
    role: 'AccountAdmin' as Role,
    userId: USER_ID,
  })
  expect(deps.events.captured.some((e) => e._tag === 'inbox.item.unassigned')).toBe(true)
})
```

**Step 2: Run — FAIL**

**Step 3: Add `InboxItemUnassigned` type to events.ts, add to union, add constructor**

**Step 4: Emit in `assign-inbox-item.ts` when `assignedToUserId` is null**

**Step 5: Export in shared events**

**Step 6: Run — PASS**

**Step 7: Commit** — `feat(inbox): emit inbox.item.unassigned event`

---

### Task 1.3: Add `inbox.item.escalated` event type

**Objective:** Dedicated event for escalation (currently `inbox.status.changed` covers it, but Q14 wants a distinct tag for the activity log to differentiate escalation from generic status change).

**Decision needed:** The grill session mapped `inbox.escalated` as a separate event. Currently escalation goes through `inbox.status.changed` with `newStatus: 'escalated'`. Two options:

- **A:** Add a dedicated `inbox.item.escalated` event emitted alongside `inbox.status.changed` when escalation happens
- **B:** Activity job handler checks `inbox.status.changed` payload for `newStatus === 'escalated'` and maps to escalated action

**Recommendation: A** — cleaner for the activity log, follows Q14 mapping exactly. The `update-inbox-status` use case emits both events when escalating.

**Files:** Same pattern as above — `events.ts`, `update-inbox-status.ts`, its test, `events.ts` shared.

**TDD cycle:** Write test for dual-emit on escalation → implement → verify → commit.

---

### Task 1.4: Add `inbox.bulk.status.changed` event type

**Objective:** Separate tag for bulk operations so activity handler can attach `bulk_id`.

**Files:**

- Modify: `src/contexts/inbox/domain/events.ts`
- Modify: `src/contexts/inbox/application/use-cases/bulk-update-inbox-status.ts`
- Modify: its test
- Modify: `src/shared/events/events.ts`

**Details:** New `InboxBulkStatusChanged` type with `bulkId` field (UUID generated in the use case). Replace `inboxStatusChanged` emit in bulk use case with `inboxBulkStatusChanged`. Keep per-item `inboxStatusChanged` for non-bulk path.

**TDD cycle:** Test that bulk emits `inbox.bulk.status.changed` with a `bulkId` → implement → verify → commit.

---

### Task 1.5: Add `reply.submitted`, `reply.approved`, `reply.rejected` events

**Objective:** Three new events in the review context for the reply approval lifecycle.

**Files:**

- Modify: `src/contexts/review/domain/events.ts`
- Add `ReplySubmitted`, `ReplyApproved`, `ReplyRejected` types
- Extend `ReplyEvent` union
- Modify: `src/contexts/review/application/use-cases/reply-operations.ts` — emit events in `submitReply`, `approveReply`, `rejectReply`
- Modify: `src/contexts/review/application/use-cases/reply-operations.test.ts`
- Modify: `src/shared/events/events.ts`

**Each event has:**

- `replyId`, `reviewId`, `organizationId`, `propertyId`
- `userId` (who performed the action)
- `occurredAt`
- `reply.rejected` additionally has `reason?: string`

**TDD cycle per event:** Test emit in submit → implement → verify. Repeat for approve, reject. Commit each.

---

## Phase 2: Activity Context — Domain Layer

### Task 2.1: Create activity context directory structure and CONTEXT.md

**TDD:** Skip — directory/file creation, no behavior.

**Files:**

- Create: `src/contexts/activity/CONTEXT.md`
- Create: `src/contexts/activity/domain/` (empty, placeholder)

**CONTEXT.md** documents all Q11–Q16 decisions.

---

### Task 2.2: Define `ActivityLog` entity type and `ActivityAction` vocabulary

**Objective:** Core domain types.

**Files:**

- Create: `src/contexts/activity/domain/activity-log.ts`
- Create: `src/contexts/activity/domain/activity-log.test.ts`

**Types:**

```typescript
export type ActivityAction =
  | 'created'
  | 'changed'
  | 'deleted'
  | 'assigned'
  | 'unassigned'
  | 'published'
  | 'rejected'
  | 'approved'
  | 'submitted'
  | 'added'
  | 'invited'
  | 'escalated'

export type ResourceType =
  | 'inbox_item'
  | 'review'
  | 'reply'
  | 'note'
  | 'property'
  | 'member'

export type ActivityLog = Readonly<{
  id: ActivityLogId
  actorId: UserId
  actorName: string // denormalized (Q9)
  actorAvatarUrl: string | null // denormalized (Q9)
  actorRole: Role
  action: ActivityAction
  resourceType: ResourceType
  resourceId: string
  propertyId: PropertyId | null
  organizationId: OrganizationId
  payload: ActivityPayload
  source: 'web' | 'api' | 'system' | 'import'
  createdAt: Date
}>

export type ActivityPayload = Readonly<{
  subject: string
  from: string | null
  to: string | null
  detail: string | null
  bulkId?: string
}>
```

**TDD:** Test that `createActivityLog` constructor validates required fields, rejects invalid actions. Constructor lives in domain.

---

### Task 2.3: Define event-to-activity mapping function

**Objective:** Pure function that maps a `DomainEvent` to an `ActivityLog` entry (or returns nothing for excluded events).

**Files:**

- Create: `src/contexts/activity/domain/event-to-activity.ts`
- Create: `src/contexts/activity/domain/event-to-activity.test.ts`

**Mapping (Q14):**

| Event `_tag`                | `action`     | `subject`    | `from`/`to`        | `detail`     |
| --------------------------- | ------------ | ------------ | ------------------ | ------------ |
| `inbox.item.created`        | `created`    | `inbox_item` | null/null          | source info  |
| `inbox.status.changed`      | `changed`    | `status`     | old/new            | null         |
| `inbox.item.escalated`      | `escalated`  | `inbox_item` | old/null           | null         |
| `inbox.item.assigned`       | `assigned`   | `inbox_item` | null/assignee name | null         |
| `inbox.item.unassigned`     | `unassigned` | `inbox_item` | prev/null          | null         |
| `inbox.note.added`          | `added`      | `note`       | null/null          | text preview |
| `reply.published`           | `published`  | `reply`      | null/null          | null         |
| `reply.submitted`           | `submitted`  | `reply`      | null/null          | null         |
| `reply.approved`            | `approved`   | `reply`      | null/null          | null         |
| `reply.rejected`            | `rejected`   | `reply`      | null/null          | reason       |
| `inbox.bulk.status.changed` | `changed`    | `status`     | null/new status    | bulk count   |

Excluded: `cache.invalidated`, `item.read` (auto).

**TDD:** One test per event mapping. Test excluded events return `null`. Test that `bulk_id` propagates.

---

## Phase 3: Activity Context — Infrastructure Layer

### Task 3.1: Drizzle schema for `activity_log` table

**Files:**

- Create: `src/shared/db/schema/activity.schema.ts`
- Modify: `src/shared/db/schema/index.ts` — add export
- Create: migration via `pnpm drizzle-kit generate`

**Schema (Q13):**

```typescript
export const activityLog = pgTable(
  'activity_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: varchar('actor_id', { length: 255 }).notNull(),
    actorName: varchar('actor_name', { length: 255 }).notNull(),
    actorAvatarUrl: text('actor_avatar_url'),
    actorRole: varchar('actor_role', { length: 50 }).notNull(),
    action: varchar('action', { length: 50 }).notNull(),
    resourceType: varchar('resource_type', { length: 50 }).notNull(),
    resourceId: varchar('resource_id', { length: 255 }).notNull(),
    propertyId: varchar('property_id', { length: 255 }),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    payload: jsonb('payload').notNull().default({}),
    source: varchar('source', { length: 20 }).notNull().default('web'),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index('activity_log_resource_idx').on(t.resourceType, t.resourceId, t.createdAt),
    index('activity_log_org_property_idx').on(
      t.organizationId,
      t.propertyId,
      t.createdAt,
    ),
    index('activity_log_actor_idx').on(t.actorId, t.createdAt),
  ],
)
```

**TDD:** Schema files don't need tests directly. Verify via migration + integration test later.

---

### Task 3.2: Repository port and Drizzle implementation

**Files:**

- Create: `src/contexts/activity/ports/activity-repository.port.ts`
- Create: `src/contexts/activity/infrastructure/activity-repository.drizzle.ts`
- Create: `src/contexts/activity/infrastructure/activity-repository.drizzle.test.ts`

**Port interface:**

```typescript
export type ActivityRepository = Readonly<{
  insert(entry: ActivityLog): Promise<void>
  findByResource(
    resourceType: ResourceType,
    resourceId: string,
    limit: number,
  ): Promise<readonly ActivityLog[]>
  findByOrganization(
    orgId: OrganizationId,
    filter: ActivityFilter,
    pagination: Pagination,
  ): Promise<readonly ActivityLog[]>
}>
```

**TDD:** Test `insert` then `findByResource` returns it. Test `findByOrganization` with permission filtering.

---

### Task 3.3: BullMQ job handler for activity logging

**Files:**

- Create: `src/contexts/activity/infrastructure/activity-job-handler.ts`
- Create: `src/contexts/activity/infrastructure/activity-job-handler.test.ts`

**Job handler:**

1. Receives a `DomainEvent` as job data
2. Calls `eventToActivity(event)` to get mapping
3. If mapping returns `null` (excluded event), skip
4. Resolves actor name/avatar via `UserLookupPort`
5. Inserts via repository

**Deps:** `repo: ActivityRepository`, `userLookup: UserLookupPort`, `clock`, `logger`

**TDD:** Test that handler maps event and inserts. Test excluded event produces no insert. Test user lookup failure is logged but doesn't crash.

---

### Task 3.4: User lookup port and identity adapter

**Files:**

- Create: `src/contexts/activity/ports/user-lookup.port.ts`
- Create: `src/contexts/activity/infrastructure/adapters/identity-user-lookup.adapter.ts`

**Port:**

```typescript
export type UserLookupPort = Readonly<{
  lookupUser(
    userId: string,
    orgId: string,
  ): Promise<{ name: string; avatarUrl: string | null; role: Role }>
}>
```

**Adapter:** Delegates to identity context's public API. Same pattern as inbox's `ReviewLookupAdapter`.

**TDD:** Test adapter with fake identity port.

---

## Phase 4: Activity Context — Queries

### Task 4.1: `getActivityTimeline` query

**Files:**

- Create: `src/contexts/activity/queries/get-activity-timeline.query.ts`
- Create: `src/contexts/activity/queries/get-activity-timeline.query.test.ts`

Returns activity entries for a specific resource (e.g., an inbox item), ordered by `createdAt` desc. Accepts `resourceType`, `resourceId`, `organizationId`, `userId`, `role` for permission check.

**Permission logic (Q11):**

- Admin: no filtering
- PM: only entries where `propertyId` is in their assigned properties
- Staff: only entries where `propertyId` is in their accessible properties

**TDD:** Test returns entries. Test permission filtering excludes entries from inaccessible properties.

---

### Task 4.2: `getOrgActivity` query

**Files:**

- Create: `src/contexts/activity/queries/get-org-activity.query.ts`
- Create: `src/contexts/activity/queries/get-org-activity.query.test.ts`

Returns org-wide activity feed with pagination. Same permission filtering as above.

**TDD:** Test pagination. Test permission scoping.

---

## Phase 5: Activity Context — Wiring

### Task 5.1: Build function

**Files:**

- Create: `src/contexts/activity/build.ts`

Wires: repo, user lookup adapter, job handler factory, event subscriptions, queries, public API.

**Event subscriptions (Q12):**

```typescript
// In build or in a registerActivityHandlers function:
eventBus.on('inbox.item.created', async (event) => {
  await jobQueue.add('log-activity', event)
})
eventBus.on('inbox.status.changed', async (event) => {
  await jobQueue.add('log-activity', event)
})
// ... one per mapped event tag
```

**Public API exports queries only — no commands.**

**TDD:** Test that build returns expected shape. Test that event subscriptions enqueue jobs.

---

### Task 5.2: Wire into composition.ts

**Files:**

- Modify: `src/composition.ts` — import and call `buildActivityContext`
- Modify: `src/bootstrap.ts` — register `log-activity` job handler

**TDD:** Integration — verify container builds, job handler registered.

---

### Task 5.3: Wire into worker

**Files:**

- Modify: `src/worker/index.ts` — no scheduling needed (activity jobs are event-driven, not recurring)

Just ensure the job handler is registered via `bootstrap()`.

---

## Phase 6: Inbox Milestone Fields

### Task 6.1: Add `firstReplySubmittedAt` and `firstReplyPublishedAt` to inbox items

**Files:**

- Modify: `src/shared/db/schema/inbox.schema.ts` — add columns
- Modify: `src/contexts/inbox/domain/types.ts` — add to `InboxItem` type
- Modify: `src/contexts/inbox/infrastructure/event-handlers/on-reply-published.ts` — set milestone
- Create: migration
- Update: test fixtures and tests

**TDD:** Test that reply.published handler sets `firstReplyPublishedAt` only once (on first reply). Test idempotency.

---

## Phase 7: Reply Milestone Fields

### Task 7.1: Add `submittedAt` and `approvedAt` to replies

**Files:**

- Modify: review schema (`src/shared/db/schema/review.schema.ts`) — add columns to replies table
- Modify: `src/contexts/review/domain/types.ts` — add to `Reply` type
- Modify: reply operations use cases — set timestamps on submit/approve
- Create: migration
- Update: test fixtures and tests

**TDD:** Test that `submitReply` sets `submittedAt`. Test that `approveReply` sets `approvedAt`.

---

## Phase 8: Verification Loop

### Task 8.1: Full build + test suite

Run `pnpm build && pnpm test`. Fix any type errors, test failures.

### Task 8.2: Review against decisions

Re-read `src/contexts/inbox/CONTEXT.md` lines 157–163. Verify every decision is implemented:

- [ ] Q11: Permission model mirrors inbox access
- [ ] Q12: BullMQ-backed delivery
- [ ] Q13: Polymorphic schema with indexes
- [ ] Q14: Event mapping (8 events, excluded 2)
- [ ] Q15: Standalone context at `src/contexts/activity/`
- [ ] Q16: Directory structure, no use cases, queries only

### Task 8.3: Repeat if needed

If review finds gaps, create fix tasks and loop.

---

## Dependency Graph

```
Phase 1 (events) ──→ Phase 2 (domain types + mapping) ──→ Phase 3 (infra) ──→ Phase 4 (queries) ──→ Phase 5 (wiring)

Phase 6 (inbox milestones) ← depends on Phase 1 (reply.published event exists)
Phase 7 (reply milestones) ← independent of activity context, can run parallel with Phase 2-5
Phase 8 (verification) ← after everything
```

**Parallelizable:**

- Phase 6 + Phase 7 can run in parallel with each other
- Phase 7 is fully independent of activity context
- Phase 1 must complete before Phase 2
