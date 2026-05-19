# Inbox Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all Important and Minor issues from the code review to make the inbox detail view functional, improve test coverage, clean up dead dependencies, and reduce test code duplication.

**Architecture:** Six focused tasks addressing: (1) detail view data layer — implement `findDetailById` JOINs, (2) notes data layer — add notes loading to detail sheet, (3) test coverage — add tests for `get-inbox-item-detail`, (4) dead code removal — remove unused `events` dep from event handlers, (5) type safety — add safe `unbrand()` utility, (6) test deduplication — extract shared in-memory repo factory.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, Vitest, React, TanStack Start

---

## File Structure Map

| File                                                                        | Action | Responsibility                                                        |
| --------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------- |
| `src/contexts/inbox/infrastructure/repositories/inbox.repository.ts`        | Modify | Implement `findDetailById` with LEFT JOINs to reviews/feedback tables |
| `src/contexts/inbox/infrastructure/repositories/inbox.repository.test.ts`   | Modify | Add detail view test                                                  |
| `src/contexts/inbox/application/use-cases/get-inbox-item-detail.test.ts`    | Create | Tests for get-inbox-item-detail use case                              |
| `src/contexts/inbox/infrastructure/event-handlers/on-review-created.ts`     | Modify | Remove unused `events` from Deps                                      |
| `src/contexts/inbox/infrastructure/event-handlers/on-feedback-submitted.ts` | Modify | Remove unused `events` from Deps                                      |
| `src/contexts/inbox/infrastructure/event-handlers/index.ts`                 | Modify | Remove `events` from registration deps                                |
| `src/shared/domain/ids.ts`                                                  | Modify | Add `unbrand()` utility                                               |
| `src/contexts/inbox/infrastructure/event-handlers/on-review-updated.ts`     | Modify | Use `unbrand()` instead of double cast                                |
| `src/components/inbox/inbox-detail-sheet.tsx`                               | Modify | Load notes via server function                                        |
| `src/contexts/inbox/server/inbox.ts`                                        | Modify | Add `getInboxNotesFn` server function                                 |
| `src/shared/testing/in-memory-inbox-repo.ts`                                | Create | Shared in-memory inbox repo factory                                   |
| `src/contexts/inbox/application/use-cases/get-inbox-items.test.ts`          | Modify | Import shared factory                                                 |
| `src/contexts/inbox/application/use-cases/add-inbox-note.test.ts`           | Modify | Import shared factory                                                 |
| `src/contexts/inbox/application/use-cases/assign-inbox-item.test.ts`        | Modify | Import shared factory                                                 |
| `src/contexts/inbox/application/use-cases/update-inbox-status.test.ts`      | Modify | Import shared factory                                                 |
| `src/contexts/inbox/application/use-cases/bulk-update-inbox-status.test.ts` | Modify | Import shared factory                                                 |

---

### Task 1: Implement `findDetailById` with LEFT JOINs

**Files:**

- Modify: `src/contexts/inbox/infrastructure/repositories/inbox.repository.ts:223-247`
- Modify: `src/contexts/inbox/infrastructure/repositories/inbox.repository.test.ts`

**Context:** The current `findDetailById` returns null for all source data fields (`reviewerName`, `reviewText`, `feedbackComment`, etc.). The inbox item needs to JOIN with the `reviews` and `feedback` tables to populate these fields. The `sourceType` field determines which table to JOIN.

Check the schema for reviews and feedback table column names:

```bash
# Check reviews table columns
grep -A 30 'export const reviews' src/shared/db/schema/reviews.schema.ts

# Check feedback table columns
grep -A 30 'export const feedback' src/shared/db/schema/feedback.schema.ts
```

- [ ] **Step 1: Check schema column names**

Run the bash commands above to find the exact column names in the `reviews` and `feedback` tables. Note: `reviews` likely has `reviewerName`, `text`/`content`, `profilePhotoUrl` columns. `feedback` likely has `comment` column.

- [ ] **Step 2: Implement `findDetailById` with conditional JOINs**

Replace the current `findDetailById` implementation in `src/contexts/inbox/infrastructure/repositories/inbox.repository.ts`:

```typescript
  findDetailById: async (id: InboxItemId, orgId: OrganizationId) => {
    return trace('inbox.findDetailById', async () => {
      const rows = await db
        .select()
        .from(inboxItems)
        .where(and(eq(inboxItems.id, id), eq(inboxItems.organizationId, orgId)))
        .limit(1)

      if (!rows[0]) return null

      const item = inboxItemFromRow(rows[0])

      // JOIN with source table based on sourceType
      if (item.sourceType === 'review') {
        const { reviews } = await import('#/shared/db/schema/reviews.schema')
        const reviewRows = await db
          .select({
            reviewerName: reviews.reviewerName,
            reviewText: reviews.text,
            reviewerProfilePhotoUrl: reviews.profilePhotoUrl,
          })
          .from(reviews)
          .where(
            and(
              eq(reviews.id, item.sourceId as ReviewId),
              eq(reviews.organizationId, orgId),
            ),
          )
          .limit(1)

        const review = reviewRows[0]
        return {
          item,
          reviewerName: review?.reviewerName ?? null,
          reviewText: review?.reviewText ?? null,
          reviewerProfilePhotoUrl: review?.reviewerProfilePhotoUrl ?? null,
          feedbackComment: null,
          feedbackRatingValue: null,
        }
      }

      // sourceType === 'feedback'
      const { feedback } = await import('#/shared/db/schema/feedback.schema')
      const feedbackRows = await db
        .select({
          comment: feedback.comment,
          ratingValue: feedback.ratingValue,
        })
        .from(feedback)
        .where(
          and(
            eq(feedback.id, item.sourceId as FeedbackId),
            eq(feedback.organizationId, orgId),
          ),
        )
        .limit(1)

      const fb = feedbackRows[0]
      return {
        item,
        reviewerName: null,
        reviewText: null,
        reviewerProfilePhotoUrl: null,
        feedbackComment: fb?.comment ?? null,
        feedbackRatingValue: fb?.ratingValue ?? null,
      }
    })
  },
```

**Note:** Adjust column names (`reviews.text`, `reviews.profilePhotoUrl`, `feedback.comment`, `feedback.ratingValue`) to match actual schema. The import is dynamic to avoid circular dependencies.

- [ ] **Step 3: Update in-memory repo `findDetailById` in tests**

In `src/contexts/inbox/infrastructure/repositories/inbox.repository.test.ts`, update the in-memory `findDetailById` to return non-null source data when the item exists:

```typescript
    findDetailById: async (id, orgId) => {
      const item = items.find(i => i.id === id && i.organizationId === orgId)
      if (!item) return null
      // Return simulated source data based on sourceType
      if (item.sourceType === 'review') {
        return {
          item,
          reviewerName: 'Test Reviewer',
          reviewText: 'Test review text',
          reviewerProfilePhotoUrl: null,
          feedbackComment: null,
          feedbackRatingValue: null,
        }
      }
      return {
        item,
        reviewerName: null,
        reviewText: null,
        reviewerProfilePhotoUrl: null,
        feedbackComment: 'Test feedback comment',
        feedbackRatingValue: item.rating,
      }
    },
```

- [ ] **Step 4: Run tests**

```bash
pnpm test src/contexts/inbox --run
```

Expected: All inbox tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/contexts/inbox/infrastructure/repositories/inbox.repository.ts src/contexts/inbox/infrastructure/repositories/inbox.repository.test.ts
git commit -m "fix(inbox): implement findDetailById with source table JOINs"
```

---

### Task 2: Add notes loading to InboxDetailSheet

**Files:**

- Create: `src/contexts/inbox/application/use-cases/get-inbox-notes.ts`
- Create: `src/contexts/inbox/application/use-cases/get-inbox-notes.test.ts`
- Modify: `src/contexts/inbox/application/ports/inbox-note.repository.ts`
- Modify: `src/contexts/inbox/infrastructure/repositories/inbox-note.repository.ts`
- Modify: `src/contexts/inbox/server/inbox.ts`
- Modify: `src/components/inbox/inbox-detail-sheet.tsx`

**Context:** The `InboxDetailSheet` component has a `notes` state that is never populated. We need a use case to fetch notes for an inbox item, a server function to expose it, and wire it into the detail sheet.

- [ ] **Step 1: Check inbox-note repository port**

Read `src/contexts/inbox/application/ports/inbox-note.repository.ts` to see existing methods. It should have a `findByInboxItemId` method. If not, add it.

- [ ] **Step 2: Create `get-inbox-notes.ts` use case**

```typescript
// Inbox context — get inbox notes use case
// Returns all notes for a single inbox item.

import type { InboxNoteRepository } from '../ports/inbox-note.repository'
import type { InboxItemId, OrganizationId } from '#/shared/domain/ids'
import type { InboxNote } from '../../domain/types'

export type GetInboxNotesInput = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
}>

// fallow-ignore-next-line unused-type
export type GetInboxNotesDeps = Readonly<{
  noteRepo: InboxNoteRepository
}>

export const getInboxNotes =
  (deps: GetInboxNotesDeps) =>
  async (input: GetInboxNotesInput): Promise<ReadonlyArray<InboxNote>> => {
    return deps.noteRepo.findByInboxItemId(input.inboxItemId, input.organizationId)
  }

// fallow-ignore-next-line unused-type
export type GetInboxNotesUseCase = ReturnType<typeof getInboxNotes>
```

- [ ] **Step 3: Create `get-inbox-notes.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { getInboxNotes } from './get-inbox-notes'
import { inboxItemId, organizationId, userId } from '#/shared/domain/ids'
import type { InboxNote } from '../../domain/types'

function createInMemoryNoteRepo() {
  const notes: InboxNote[] = []
  const repo = {
    create: async (note: InboxNote) => {
      notes.push(note)
      return note
    },
    findByInboxItemId: async (inboxItemId: string, orgId: string) =>
      notes.filter((n) => n.inboxItemId === inboxItemId && n.organizationId === orgId),
  }
  return { ...repo, notes }
}

const ORG_ID = organizationId('org-1')
const ITEM_ID = inboxItemId('item-1')
const USER_ID = userId('user-1')
const FIXED_TIME = new Date('2026-04-15T12:00:00Z')

describe('getInboxNotes', () => {
  it('returns notes for an inbox item', async () => {
    const noteRepo = createInMemoryNoteRepo()
    noteRepo.notes.push({
      id: 'note-1' as any,
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      authorUserId: USER_ID,
      text: 'Test note',
      createdAt: FIXED_TIME,
    })

    const useCase = getInboxNotes({ noteRepo })
    const result = await useCase({ inboxItemId: ITEM_ID, organizationId: ORG_ID })

    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('Test note')
  })

  it('returns empty array when no notes exist', async () => {
    const noteRepo = createInMemoryNoteRepo()
    const useCase = getInboxNotes({ noteRepo })
    const result = await useCase({ inboxItemId: ITEM_ID, organizationId: ORG_ID })

    expect(result).toHaveLength(0)
  })

  it('does not return notes from other organizations', async () => {
    const noteRepo = createInMemoryNoteRepo()
    const otherOrg = organizationId('org-2')
    noteRepo.notes.push({
      id: 'note-1' as any,
      inboxItemId: ITEM_ID,
      organizationId: otherOrg,
      authorUserId: USER_ID,
      text: 'Other org note',
      createdAt: FIXED_TIME,
    })

    const useCase = getInboxNotes({ noteRepo })
    const result = await useCase({ inboxItemId: ITEM_ID, organizationId: ORG_ID })

    expect(result).toHaveLength(0)
  })
})
```

- [ ] **Step 4: Check and wire the note repository**

Read `src/contexts/inbox/infrastructure/repositories/inbox-note.repository.ts` to verify `findByInboxItemId` exists. If it doesn't, add it:

```typescript
  findByInboxItemId: async (inboxItemId: InboxItemId, orgId: OrganizationId) => {
    return trace('inboxNote.findByInboxItemId', async () => {
      const rows = await db
        .select()
        .from(inboxNotes)
        .where(
          and(
            eq(inboxNotes.inboxItemId, inboxItemId),
            eq(inboxNotes.organizationId, orgId),
          ),
        )
        .orderBy(desc(inboxNotes.createdAt))
      return rows.map(inboxNoteFromRow)
    })
  },
```

- [ ] **Step 5: Add server function in `inbox.ts`**

Read `src/contexts/inbox/server/inbox.ts` to understand the pattern. Add a new server function:

```typescript
export const getInboxNotesFn = createServerFn({ method: 'GET' })
  .validator(z.object({ inboxItemId: z.string() }))
  .handler(
    tracedHandler(async ({ data }) => {
      const ctx = await resolveTenantContext(request.headers)
      const result = await getInboxNotes(deps)({
        inboxItemId: inboxItemId(data.inboxItemId),
        organizationId: ctx.organizationId,
      })
      clearTenantCache()
      return result
    }),
  )
```

Add necessary imports: `getInboxNotes` use case, `inboxItemId` brand, `z` from zod.

- [ ] **Step 6: Wire `getInboxNotes` into the detail sheet**

Modify `src/components/inbox/inbox-detail-sheet.tsx`:

```typescript
// Add import
import {
  getInboxItemDetailFn,
  getInboxNotesFn,
  updateInboxStatusFn,
} from '#/contexts/inbox/server/inbox'

// Add server fn hook
const notesAction = useAction(useServerFn(getInboxNotesFn))

// Modify loadDetail to also load notes
const loadDetail = useCallback(async () => {
  if (!item) return
  abortRef.current = false
  setIsLoadingDetail(true)
  try {
    const [detailResult, notesResult] = await Promise.all([
      detailAction({ data: { inboxItemId: item.id } }),
      notesAction({ data: { inboxItemId: item.id } }),
    ])
    if (!abortRef.current) {
      if (detailResult) setDetail(detailResult)
      if (notesResult) setNotes(notesResult)
    }
  } catch {
    // Error is on detailAction.error
  } finally {
    if (!abortRef.current) setIsLoadingDetail(false)
  }
}, [item?.id])
```

- [ ] **Step 7: Run tests**

```bash
pnpm test src/contexts/inbox --run
```

Expected: All inbox tests pass including new `get-inbox-notes.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/contexts/inbox/application/use-cases/get-inbox-notes.ts src/contexts/inbox/application/use-cases/get-inbox-notes.test.ts src/contexts/inbox/server/inbox.ts src/components/inbox/inbox-detail-sheet.tsx
git commit -m "feat(inbox): add notes loading to detail sheet"
```

---

### Task 3: Add tests for `get-inbox-item-detail` use case

**Files:**

- Create: `src/contexts/inbox/application/use-cases/get-inbox-item-detail.test.ts`

**Context:** `get-inbox-item-detail.ts` is the only use case without test coverage. Need happy path and not_found tests.

- [ ] **Step 1: Create test file**

```typescript
import { describe, it, expect } from 'vitest'
import { getInboxItemDetail } from './get-inbox-item-detail'
import { inboxItemId, organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type {
  InboxItem,
  InboxItemDetail,
  InboxStatus,
  SourceType,
} from '../../domain/types'
import type { InboxRepository } from '../ports/inbox.repository'

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const ORG_ID = organizationId('org-1')
const OTHER_ORG_ID = organizationId('org-2')
const ITEM_ID = inboxItemId('ii-1')
const PROP_ID = propertyId('prop-1')

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: ITEM_ID,
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    sourceType: 'review' as SourceType,
    sourceId: reviewId('rev-1'),
    status: 'new' as InboxStatus,
    rating: 4,
    sourceDate: FIXED_TIME,
    platform: 'google',
    snippet: 'Great!',
    assignedTo: null,
    readAt: null,
    escalatedAt: null,
    addressedAt: null,
    archivedAt: null,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...overrides,
  }
}

function makeDetail(item: InboxItem): InboxItemDetail {
  return {
    item,
    reviewerName: 'Test Reviewer',
    reviewText: 'Test review',
    reviewerProfilePhotoUrl: null,
    feedbackComment: null,
    feedbackRatingValue: null,
  }
}

const setup = () => {
  let storedItem: InboxItem | null = null
  let storedDetail: InboxItemDetail | null = null
  const repo: InboxRepository = {
    findById: async (id, orgId) =>
      storedItem && storedItem.id === id && storedItem.organizationId === orgId
        ? storedItem
        : null,
    findBySource: async () => null,
    findFilteredPaginated: async () => ({ items: [], nextCursor: null }),
    create: async (item) => {
      storedItem = item
      return item
    },
    updateStatus: async () => storedItem!,
    bulkUpdateStatus: async () => ({ updated: 0 }),
    updateAssignment: async () => storedItem!,
    countByStatus: async () => 0,
    syncDenormalizedFields: async () => {},
    findDetailById: async (id, orgId) =>
      storedDetail &&
      storedDetail.item.id === id &&
      storedDetail.item.organizationId === orgId
        ? storedDetail
        : null,
  }
  return {
    repo,
    setItem: (item: InboxItem) => {
      storedItem = item
    },
    setDetail: (d: InboxItemDetail) => {
      storedDetail = d
    },
  }
}

describe('getInboxItemDetail', () => {
  it('returns detail for a valid inbox item', async () => {
    const { repo, setItem, setDetail } = setup()
    const item = makeItem()
    const detail = makeDetail(item)
    setItem(item)
    setDetail(detail)

    const useCase = getInboxItemDetail({ repo })
    const result = await useCase({ inboxItemId: ITEM_ID, organizationId: ORG_ID })

    expect(result.item.id).toBe(ITEM_ID)
    expect(result.reviewerName).toBe('Test Reviewer')
    expect(result.reviewText).toBe('Test review')
  })

  it('throws not_found when item does not exist', async () => {
    const { repo } = setup()
    const useCase = getInboxItemDetail({ repo })

    await expect(
      useCase({ inboxItemId: inboxItemId('nonexistent'), organizationId: ORG_ID }),
    ).rejects.toThrow('Inbox item not found')
  })

  it('does not return item from another organization', async () => {
    const { repo, setItem, setDetail } = setup()
    const item = makeItem({ organizationId: OTHER_ORG_ID })
    setItem(item)
    setDetail(makeDetail(item))

    const useCase = getInboxItemDetail({ repo })

    await expect(
      useCase({ inboxItemId: ITEM_ID, organizationId: ORG_ID }),
    ).rejects.toThrow('Inbox item not found')
  })
})
```

- [ ] **Step 2: Run tests**

```bash
pnpm test src/contexts/inbox/application/use-cases/get-inbox-item-detail.test.ts --run
```

Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/contexts/inbox/application/use-cases/get-inbox-item-detail.test.ts
git commit -m "test(inbox): add tests for get-inbox-item-detail use case"
```

---

### Task 4: Remove unused `events` dependency from event handlers

**Files:**

- Modify: `src/contexts/inbox/infrastructure/event-handlers/on-review-created.ts`
- Modify: `src/contexts/inbox/infrastructure/event-handlers/on-feedback-submitted.ts`
- Modify: `src/contexts/inbox/infrastructure/event-handlers/index.ts`

**Context:** `OnReviewCreatedDeps` and `OnFeedbackSubmittedDeps` include `events: EventBus` but neither handler calls `deps.events`. This is dead dependency injection.

- [ ] **Step 1: Remove `events` from `on-review-created.ts`**

```typescript
// Inbox context — event handler for review.created
// Creates an inbox item when a new review is ingested.

import type { ReviewCreated } from '#/contexts/review/domain/events'
import type { CreateInboxItemUseCase } from '../../application/use-cases/create-inbox-item'
import { isInboxError } from '../../domain/errors'
import { getLogger } from '#/shared/observability/logger'

export type OnReviewCreatedDeps = Readonly<{
  createInboxItem: CreateInboxItemUseCase
}>

export const onReviewCreated =
  (deps: OnReviewCreatedDeps) =>
  async (event: ReviewCreated): Promise<void> => {
    try {
      await deps.createInboxItem({
        organizationId: event.organizationId,
        propertyId: event.propertyId,
        sourceType: 'review',
        sourceId: event.reviewId,
        rating: event.rating,
        sourceDate: event.occurredAt,
        platform: event.platform,
        snippet: null,
      })
    } catch (err) {
      if (isInboxError(err) && err.code === 'already_exists') return
      getLogger().error(
        { err, reviewId: event.reviewId },
        'inbox: failed to handle review.created',
      )
    }
  }
```

- [ ] **Step 2: Remove `events` from `on-feedback-submitted.ts`**

```typescript
// Inbox context — event handler for feedback.submitted
// Creates an inbox item when guest feedback is submitted.

import type { FeedbackSubmitted } from '#/contexts/guest/domain/events'
import type { CreateInboxItemUseCase } from '../../application/use-cases/create-inbox-item'
import { isInboxError } from '../../domain/errors'
import { getLogger } from '#/shared/observability/logger'

export type OnFeedbackSubmittedDeps = Readonly<{
  createInboxItem: CreateInboxItemUseCase
}>

export const onFeedbackSubmitted =
  (deps: OnFeedbackSubmittedDeps) =>
  async (event: FeedbackSubmitted): Promise<void> => {
    try {
      await deps.createInboxItem({
        organizationId: event.organizationId,
        propertyId: event.propertyId,
        sourceType: 'feedback',
        sourceId: event.feedbackId,
        rating: null,
        sourceDate: event.occurredAt,
        platform: null,
        snippet: null,
      })
    } catch (err) {
      if (isInboxError(err) && err.code === 'already_exists') return
      getLogger().error(
        { err, feedbackId: event.feedbackId },
        'inbox: failed to handle feedback.submitted',
      )
    }
  }
```

- [ ] **Step 3: Update `index.ts` registration**

```typescript
// Inbox context — event handler registration
// Wires all inbox event handlers to the event bus.

import type { EventBus } from '#/shared/events/event-bus'
import type { CreateInboxItemUseCase } from '../../application/use-cases/create-inbox-item'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import { onReviewCreated } from './on-review-created'
import { onFeedbackSubmitted } from './on-feedback-submitted'
import { onReviewUpdated } from './on-review-updated'

export type RegisterInboxHandlersDeps = Readonly<{
  events: EventBus
  createInboxItem: CreateInboxItemUseCase
  repo: InboxRepository
}>

export const registerInboxHandlers = (deps: RegisterInboxHandlersDeps): void => {
  deps.events.on(
    'review.created',
    onReviewCreated({ createInboxItem: deps.createInboxItem }),
  )
  deps.events.on(
    'feedback.submitted',
    onFeedbackSubmitted({ createInboxItem: deps.createInboxItem }),
  )
  deps.events.on('review.updated', onReviewUpdated(deps))
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test src/contexts/inbox --run
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/contexts/inbox/infrastructure/event-handlers/on-review-created.ts src/contexts/inbox/infrastructure/event-handlers/on-feedback-submitted.ts src/contexts/inbox/infrastructure/event-handlers/index.ts
git commit -m "refactor(inbox): remove unused events dep from event handlers"
```

---

### Task 5: Add safe `unbrand()` utility and use in `on-review-updated`

**Files:**

- Modify: `src/shared/domain/ids.ts`
- Modify: `src/contexts/inbox/infrastructure/event-handlers/on-review-updated.ts`

**Context:** The `on-review-updated` handler uses `event.reviewId as unknown as string` to unbrand a branded ID. This is fragile. A safe `unbrand()` utility makes the intent explicit.

- [ ] **Step 1: Read `src/shared/domain/ids.ts` to find brand pattern**

Check how branded IDs are defined. They likely use a pattern like:

```typescript
type Branded<T, Brand extends string> = T & { readonly __brand: Brand }
export type InboxItemId = Branded<string, 'InboxItemId'>
```

- [ ] **Step 2: Add `unbrand()` utility**

Add to `src/shared/domain/ids.ts`:

```typescript
/** Safely strip brand from a branded ID type for use at infrastructure boundaries. */
export function unbrand<T extends string>(branded: T): string {
  return String(branded)
}
```

- [ ] **Step 3: Update `on-review-updated.ts`**

```typescript
// Inbox context — event handler for review.updated
// Syncs denormalized fields (rating) when a review is updated.

import type { ReviewUpdated } from '#/contexts/review/domain/events'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import { getLogger } from '#/shared/observability/logger'
import { unbrand } from '#/shared/domain/ids'

export type OnReviewUpdatedDeps = Readonly<{
  repo: InboxRepository
}>

export const onReviewUpdated =
  (deps: OnReviewUpdatedDeps) =>
  async (event: ReviewUpdated): Promise<void> => {
    try {
      const sourceId = unbrand(event.reviewId)
      const item = await deps.repo.findBySource('review', sourceId, event.organizationId)
      if (!item) return

      await deps.repo.syncDenormalizedFields(item.id, item.organizationId, {
        rating: event.rating,
      })
    } catch (err) {
      getLogger().error(
        { err, reviewId: event.reviewId },
        'inbox: failed to handle review.updated',
      )
    }
  }
```

- [ ] **Step 4: Run tests**

```bash
pnpm test src/contexts/inbox --run
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/domain/ids.ts src/contexts/inbox/infrastructure/event-handlers/on-review-updated.ts
git commit -m "refactor(inbox): use safe unbrand() utility instead of double cast"
```

---

### Task 6: Extract shared in-memory inbox repo factory

**Files:**

- Create: `src/shared/testing/in-memory-inbox-repo.ts`
- Modify: `src/contexts/inbox/application/use-cases/get-inbox-items.test.ts`
- Modify: `src/contexts/inbox/application/use-cases/add-inbox-note.test.ts`
- Modify: `src/contexts/inbox/application/use-cases/assign-inbox-item.test.ts`
- Modify: `src/contexts/inbox/application/use-cases/update-inbox-status.test.ts`
- Modify: `src/contexts/inbox/application/use-cases/bulk-update-inbox-status.test.ts`

**Context:** Multiple test files each define their own `createInMemoryInboxRepo()` (~50 lines each). Extract to shared testing utility.

- [ ] **Step 1: Create shared factory**

```typescript
// Shared testing utility — in-memory inbox repository for unit tests
import type { InboxRepository } from '#/contexts/inbox/application/ports/inbox.repository'
import type {
  InboxItem,
  InboxItemDetail,
  InboxStatus,
  SourceType,
} from '#/contexts/inbox/domain/types'
import type { InboxItemId, OrganizationId, UserId } from '#/shared/domain/ids'

export function createInMemoryInboxRepo(): InboxRepository & { items: InboxItem[] } {
  const items: InboxItem[] = []
  const repo: InboxRepository = {
    findById: async (id, orgId) =>
      items.find((i) => i.id === id && i.organizationId === orgId) ?? null,
    findBySource: async (sourceType, sourceId, orgId) =>
      items.find(
        (i) =>
          i.sourceType === sourceType &&
          i.sourceId === sourceId &&
          i.organizationId === orgId,
      ) ?? null,
    findFilteredPaginated: async (filters, orgId, cursor, limit = 50) => {
      let filtered = items.filter((i) => i.organizationId === orgId)
      if (filters.status) filtered = filtered.filter((i) => i.status === filters.status)
      if (filters.propertyId)
        filtered = filtered.filter((i) => i.propertyId === filters.propertyId)
      if (filters.sourceType)
        filtered = filtered.filter((i) => i.sourceType === filters.sourceType)
      filtered.sort(
        (a, b) =>
          b.sourceDate.getTime() - a.sourceDate.getTime() ||
          (b.id as string).localeCompare(a.id as string),
      )
      if (cursor) {
        const idx = filtered.findIndex(
          (i) =>
            i.sourceDate.getTime() === cursor.sourceDate.getTime() && i.id === cursor.id,
        )
        filtered = idx >= 0 ? filtered.slice(idx + 1) : []
      }
      const sliced = filtered.slice(0, limit)
      const last = sliced[sliced.length - 1]
      return {
        items: sliced,
        nextCursor: last ? { sourceDate: last.sourceDate, id: last.id } : null,
      }
    },
    create: async (item) => {
      items.push(item)
      return item
    },
    updateStatus: async (id, orgId, status, timestampFields) => {
      const item = items.find((i) => i.id === id && i.organizationId === orgId)
      if (!item) throw new Error('not found')
      const idx = items.indexOf(item)
      items[idx] = { ...item, status, updatedAt: new Date(), ...timestampFields }
      return items[idx]
    },
    bulkUpdateStatus: async (ids, orgId, status, timestampFields) => {
      let updated = 0
      for (const id of ids) {
        const item = items.find((i) => i.id === id && i.organizationId === orgId)
        if (item) {
          const idx = items.indexOf(item)
          items[idx] = { ...item, status, updatedAt: new Date(), ...timestampFields }
          updated++
        }
      }
      return { updated }
    },
    updateAssignment: async (id, orgId, assignedTo) => {
      const item = items.find((i) => i.id === id && i.organizationId === orgId)
      if (!item) throw new Error('not found')
      const idx = items.indexOf(item)
      items[idx] = { ...item, assignedTo, updatedAt: new Date() }
      return items[idx]
    },
    countByStatus: async (orgId, status) =>
      items.filter((i) => i.organizationId === orgId && i.status === status).length,
    syncDenormalizedFields: async () => {},
    findDetailById: async (id, orgId) => {
      const item = items.find((i) => i.id === id && i.organizationId === orgId)
      if (!item) return null
      if (item.sourceType === 'review') {
        return {
          item,
          reviewerName: 'Test Reviewer',
          reviewText: 'Test review',
          reviewerProfilePhotoUrl: null,
          feedbackComment: null,
          feedbackRatingValue: null,
        }
      }
      return {
        item,
        reviewerName: null,
        reviewText: null,
        reviewerProfilePhotoUrl: null,
        feedbackComment: 'Test feedback',
        feedbackRatingValue: item.rating,
      }
    },
  }
  return { ...repo, items }
}
```

- [ ] **Step 2: Update `get-inbox-items.test.ts`**

Replace the local `createInMemoryInboxRepo` function (lines 14-70) with:

```typescript
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
```

Remove the local function definition. The rest of the test file stays the same.

- [ ] **Step 3: Update other test files**

For each of these files, replace the local `createInMemoryInboxRepo` with the import:

```typescript
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
```

Files to update:

- `src/contexts/inbox/application/use-cases/add-inbox-note.test.ts`
- `src/contexts/inbox/application/use-cases/assign-inbox-item.test.ts`
- `src/contexts/inbox/application/use-cases/update-inbox-status.test.ts`
- `src/contexts/inbox/application/use-cases/bulk-update-inbox-status.test.ts`

- [ ] **Step 4: Run all inbox tests**

```bash
pnpm test src/contexts/inbox --run
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/testing/in-memory-inbox-repo.ts src/contexts/inbox/application/use-cases/get-inbox-items.test.ts src/contexts/inbox/application/use-cases/add-inbox-note.test.ts src/contexts/inbox/application/use-cases/assign-inbox-item.test.ts src/contexts/inbox/application/use-cases/update-inbox-status.test.ts src/contexts/inbox/application/use-cases/bulk-update-inbox-status.test.ts
git commit -m "refactor(inbox): extract shared in-memory inbox repo factory"
```

---

## Self-Review

### 1. Spec coverage check

| Review Issue                              | Task                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `get-inbox-item-detail` has no tests      | Task 3                                                                             |
| `findDetailById` returns null source data | Task 1                                                                             |
| Repository tests are compile-time only    | Noted in recommendations — integration tests require testcontainers infrastructure |
| Unused `events` dep in event handlers     | Task 4                                                                             |
| `on-review-updated` uses unsafe unbrand   | Task 5                                                                             |
| Hardcoded platform list                   | Minor — deferred (would require backend endpoint)                                  |
| Truncated authorUserId in notes           | Minor — deferred (requires user name lookup)                                       |
| Duplicate in-memory repo factories        | Task 6                                                                             |
| Bulk update best-effort                   | Existing design decision — not changing                                            |
| Notes state never populated               | Task 2                                                                             |
| RatingStars hardcoded 5                   | Minor — deferred (low priority)                                                    |

### 2. Placeholder scan

No TBD, TODO, "implement later", "add validation", "write tests for the above", or "similar to Task N" found. All steps contain actual code.

### 3. Type consistency

- `InboxItemDetail` type used consistently across Tasks 1, 2, 3
- `createInMemoryInboxRepo` return type matches `InboxRepository` port
- `unbrand()` returns `string` — matches repo method signatures
- Server function pattern matches existing `inbox.ts` patterns
- `getInboxNotes` use case follows established use case shape

---

Plan complete and saved to `docs/superpowers/plans/2026-05-19-inbox-review-fixes.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
