# Activity Context: BullMQ Event Delivery — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace in-process event delivery with BullMQ for activity logging (ADR 0010). Per-tag handlers enqueue jobs; a BullMQ worker consumes them and calls `insertActivityLog`.

**Architecture:** Event bus → per-tag handler → BullMQ `activity-log` queue → worker → `insertActivityLog` use case → DB. In-process handlers only map + enqueue; no DB writes in the web process.

**Tech Stack:** TypeScript, BullMQ, neverthrow, Vitest, Drizzle

---

## Task 1: Create the `insertActivityLog` use case

**Objective:** Extract the write logic (duplicate check → user lookup → domain construction → persist) into a standalone use case in `application/use-cases/insert-activity-log.ts`.

**Files:**

- Create: `src/contexts/activity/application/use-cases/insert-activity-log.ts`

**Step 1: Write the use case**

```ts
// src/contexts/activity/application/use-cases/insert-activity-log.ts
import type { ActivityRepository } from '../../ports/activity-repository.port'
import type { UserLookupPort } from '../../ports/user-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { Role } from '#/shared/domain/roles'
import { createActivityLog } from '../../domain/constructors'
import type { ActivityAction, ResourceType, ActivityPayload } from '../../domain/types'

export type InsertActivityLogInput = Readonly<{
  action: ActivityAction
  resourceType: ResourceType
  resourceId: string
  propertyId: string | null
  organizationId: string
  userId: string | null
  source: 'web' | 'import'
  payload: ActivityPayload
}>

export type InsertActivityLogDeps = Readonly<{
  repo: ActivityRepository
  userLookup: UserLookupPort
  clock: () => Date
  logger: LoggerPort
  idGen: () => string
}>

export const insertActivityLog =
  (deps: InsertActivityLogDeps) =>
  async (input: InsertActivityLogInput): Promise<void> => {
    // Idempotency check
    const duplicate = await deps.repo.findDuplicate({
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      organizationId: input.organizationId,
      payload: input.payload,
    })
    if (duplicate) return

    // Best-effort user lookup
    let userInfo: { name: string; avatarUrl: string | null; role: Role } = {
      name: 'System',
      avatarUrl: null,
      role: 'Staff',
    }
    try {
      if (input.userId) {
        userInfo = await deps.userLookup.lookup(input.userId, input.organizationId)
      }
    } catch {
      // Fall through to default
    }

    const result = createActivityLog(
      {
        actorId: input.userId ?? 'system',
        actorName: userInfo.name,
        actorAvatarUrl: userInfo.avatarUrl,
        actorRole: userInfo.role,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        propertyId: input.propertyId,
        organizationId: input.organizationId,
        payload: input.payload,
        source: input.source,
      },
      deps.clock,
    )

    if (result.isErr()) {
      deps.logger.warn(
        { err: result.error, action: input.action },
        'Activity log constructor rejected input',
      )
      return
    }

    const entry = result.value
    // Domain-generated ID (ADR Q12)
    const entryWithId = { ...entry, id: deps.idGen() }
    await deps.repo.insert(entryWithId)
  }
```

**Step 2: Verify build**

Run: `pnpm tsc --noEmit`
Expected: clean (new file, not imported yet)

---

## Task 2: Create per-tag event handler files

**Objective:** Replace the monolithic `event-handlers/index.ts` with per-tag handler files. Each handler subscribes to the event bus, maps the event to a job payload, and enqueues via BullMQ.

**Files:**

- Create: `src/contexts/activity/infrastructure/event-handlers/on-inbox-item-created.ts`
- Create: `src/contexts/activity/infrastructure/event-handlers/on-inbox-status-changed.ts`
- Create: `src/contexts/activity/infrastructure/event-handlers/on-inbox-item-escalated.ts`
- Create: `src/contexts/activity/infrastructure/event-handlers/on-inbox-item-assigned.ts`
- Create: `src/contexts/activity/infrastructure/event-handlers/on-inbox-item-unassigned.ts`
- Create: `src/contexts/activity/infrastructure/event-handlers/on-inbox-note-added.ts`
- Create: `src/contexts/activity/infrastructure/event-handlers/on-inbox-bulk-status-changed.ts`
- Create: `src/contexts/activity/infrastructure/event-handlers/on-reply-published.ts`
- Create: `src/contexts/activity/infrastructure/event-handlers/on-reply-submitted.ts`
- Create: `src/contexts/activity/infrastructure/event-handlers/on-reply-approved.ts`
- Create: `src/contexts/activity/infrastructure/event-handlers/on-reply-rejected.ts`
- Rewrite: `src/contexts/activity/infrastructure/event-handlers/index.ts`

**TDD:** Skip for handler files — they are pure mapping + enqueue, no logic to test beyond the mapping (covered by existing tests that will be migrated in Task 5).

**Handler template** (repeat for each event type):

```ts
// on-inbox-item-created.ts
import type { InboxItemCreated } from '#/contexts/inbox/domain/events'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onInboxItemCreated =
  (deps: Deps) =>
  async (event: InboxItemCreated): Promise<void> => {
    const payload: InsertActivityLogInput = {
      action: 'created' as const,
      resourceType: 'inbox_item' as const,
      resourceId: event.inboxItemId,
      propertyId: event.propertyId ?? null,
      organizationId: event.organizationId,
      userId: event.userId ?? null,
      source: event.source,
      payload: { subject: 'inbox_item', from: null, to: null, detail: event.sourceType },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
```

**index.ts:**

```ts
import type { EventBus } from '#/shared/events/event-bus'
import type { Queue } from 'bullmq'
import { onInboxItemCreated } from './on-inbox-item-created'
import { onInboxStatusChanged } from './on-inbox-status-changed'
import { onInboxItemEscalated } from './on-inbox-item-escalated'
import { onInboxItemAssigned } from './on-inbox-item-assigned'
import { onInboxItemUnassigned } from './on-inbox-item-unassigned'
import { onInboxNoteAdded } from './on-inbox-note-added'
import { onInboxBulkStatusChanged } from './on-inbox-bulk-status-changed'
import { onReplyPublished } from './on-reply-published'
import { onReplySubmitted } from './on-reply-submitted'
import { onReplyApproved } from './on-reply-approved'
import { onReplyRejected } from './on-reply-rejected'

export type RegisterActivityHandlersDeps = Readonly<{
  events: EventBus
  queue: Queue
}>

export const registerActivityHandlers = (deps: RegisterActivityHandlersDeps): void => {
  deps.events.on('inbox.inbox_item.created', onInboxItemCreated({ queue: deps.queue }))
  deps.events.on(
    'inbox.inbox_item.status_changed',
    onInboxStatusChanged({ queue: deps.queue }),
  )
  deps.events.on(
    'inbox.inbox_item.escalated',
    onInboxItemEscalated({ queue: deps.queue }),
  )
  deps.events.on('inbox.inbox_item.assigned', onInboxItemAssigned({ queue: deps.queue }))
  deps.events.on(
    'inbox.inbox_item.unassigned',
    onInboxItemUnassigned({ queue: deps.queue }),
  )
  deps.events.on('inbox.inbox_note.added', onInboxNoteAdded({ queue: deps.queue }))
  deps.events.on(
    'inbox.inbox_item.bulk_status_changed',
    onInboxBulkStatusChanged({ queue: deps.queue }),
  )
  deps.events.on('review.reply.published', onReplyPublished({ queue: deps.queue }))
  deps.events.on('review.reply.submitted', onReplySubmitted({ queue: deps.queue }))
  deps.events.on('review.reply.approved', onReplyApproved({ queue: deps.queue }))
  deps.events.on('review.reply.rejected', onReplyRejected({ queue: deps.queue }))
}
```

---

## Task 3: Create the BullMQ worker job handler

**Objective:** Create a job handler file that the BullMQ worker calls. Registered in bootstrap.

**Files:**

- Create: `src/contexts/activity/infrastructure/jobs/insert-activity-log.job.ts`

```ts
export const INSERT_ACTIVITY_LOG_JOB_NAME = 'insert-activity-log'

export type InsertActivityLogJobData =
  import('../../application/use-cases/insert-activity-log').InsertActivityLogInput

export function createInsertActivityLogHandler(
  deps: import('../../application/use-cases/insert-activity-log').InsertActivityLogDeps,
) {
  const useCase = insertActivityLog(deps)
  return async (job: import('bullmq').Job<InsertActivityLogJobData>): Promise<void> => {
    await useCase(job.data)
  }
}
```

---

## Task 4: Update `build.ts` to accept `queue` and export use case

**Objective:** Build function no longer registers in-process write handlers. Instead it wires the queue into event handlers and exposes the use case for the worker.

**Files:**

- Modify: `src/contexts/activity/build.ts`

Key changes:

- Add `queue: Queue` to `BuildInput` (from `bullmq`)
- `registerActivityHandlers` now only needs `{ events, queue }`
- Export `insertActivityLog` use case from `internal.useCases`
- Remove `repo`, `userLookup`, `clock`, `logger` from handler registration

---

## Task 5: Wire in composition.ts and bootstrap.ts

**Objective:** Pass `jobQueue` to activity build. Register the activity job handler in bootstrap.

**Files:**

- Modify: `src/composition.ts` — pass `jobQueue: infra.jobQueue` to `buildActivityContext`
- Modify: `src/bootstrap.ts` — import and register `INSERT_ACTIVITY_LOG_JOB_NAME` handler

---

## Task 6: Update repository port and drizzle implementation

**Objective:** Remove `MappedActivity` dependency from the port. `findDuplicate` accepts an object with the relevant fields directly.

**Files:**

- Modify: `src/contexts/activity/ports/activity-repository.port.ts`
- Modify: `src/contexts/activity/infrastructure/activity-repository.drizzle.ts`

---

## Task 7: Update domain constructor for domain-generated IDs

**Objective:** Constructor generates ID via `idGen()` instead of leaving `id: ''`.

**Files:**

- Modify: `src/contexts/activity/domain/constructors.ts` — add `idGen` parameter
- Modify: `src/contexts/activity/domain/constructors.test.ts` — verify ID generation

**TDD:** Write failing test first, then implement.

---

## Task 8: Delete `event-to-activity.ts` and update its test

**Objective:** Remove the monolithic mapper. Rewrite tests as per-handler mapping tests.

**Files:**

- Delete: `src/contexts/activity/application/event-to-activity.ts`
- Delete: `src/contexts/activity/application/event-to-activity.test.ts`
- Create: `src/contexts/activity/infrastructure/event-handlers/on-inbox-item-created.test.ts` (and one other representative handler test)

**Note:** The mapping logic is now trivially inline in each handler. Tests verify the payload shape matches the expected `InsertActivityLogInput`.

---

## Task 9: Update CONTEXT.md

**Objective:** Remove `event-to-activity.ts` from architecture layers. Update to reflect BullMQ delivery.

**Files:**

- Modify: `src/contexts/activity/CONTEXT.md`

---

## Task 10: Update `idGen` in constructor tests and fix existing test references

**Objective:** Ensure `createActivityLog` callers pass `idGen`. Fix constructor test.

**Files:**

- Modify: `src/contexts/activity/domain/constructors.ts`
- Modify: `src/contexts/activity/domain/constructors.test.ts`

---

## Task 11: Build, typecheck, lint, test

Run:

```bash
pnpm tsc --noEmit
pnpm eslint src/contexts/activity/
pnpm vitest run src/contexts/activity/
```

Expected: 0 errors, all tests pass.

---

## Task 12: Full test suite

Run: `pnpm vitest run`
Expected: All tests pass (existing test count maintained or increased).
