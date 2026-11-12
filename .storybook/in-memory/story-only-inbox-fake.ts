// Story-only Inbox fake. A browser cannot reach PostgreSQL, so Storybook renders
// the real Inbox use cases over this in-memory repository and command store.
// It is not a model of the database: every Inbox behaviour test runs against
// PostgreSQL (`*.integration.test.ts`). It carries only the filtering, counting
// and manager commands a story drives from the screen. Source-event consumers
// and the receipt fence run on the server, so those methods refuse here.
import type { InboxRepository } from '#/contexts/inbox/application/ports/inbox.repository'
import type { InboxNoteRepository } from '#/contexts/inbox/application/ports/inbox-note.repository'
import type { InboxCommandStore } from '#/contexts/inbox/application/ports/inbox-command-store.port'
import { timestampFieldsForStatus } from '#/contexts/inbox/domain/rules'
import type { InboxItem, InboxPriority } from '#/contexts/inbox/domain/types'
import { unbrandAll, type UserId } from '#/shared/domain/ids'

type InboxFilters = Parameters<InboxRepository['findFilteredPaginated']>[0]
type SourceScopes = Parameters<InboxRepository['countByStatus']>[3]

/** The star rating a story's `available` review shows in the detail pane. */
const STORY_REVIEW_RATING = 4

const matchesSourceScopes = (item: InboxItem, scopes: SourceScopes): boolean =>
  scopes === undefined ||
  scopes.some(
    (scope) =>
      scope.sourceType === item.sourceType &&
      (scope.propertyIds === undefined || scope.propertyIds.includes(item.propertyId)),
  )

const nextCommandRevision = (item: InboxItem): number => {
  const next = item.commandRevision + 1
  if (!Number.isSafeInteger(next)) {
    throw new Error('Inbox command revision is exhausted')
  }
  return next
}

/** A review matches a Priority filter through the level a person set, else the seeded `attention`. */
const effectivePriorityOf = (item: InboxItem): InboxPriority | null => {
  if (item.managerPriority) return item.managerPriority
  return item.sourceType === 'review' ? (item.attention ?? null) : null
}

type FilterCheck = (item: InboxItem, filters: InboxFilters) => boolean

const matchesStatus: FilterCheck = (item, { status }) =>
  !status ||
  (Array.isArray(status) ? status.includes(item.status) : item.status === status)

const matchesRating: FilterCheck = (item, { ratingMin, ratingMax }) =>
  (ratingMin === undefined || (item.rating ?? -Infinity) >= ratingMin) &&
  (ratingMax === undefined || (item.rating ?? Infinity) <= ratingMax)

const matchesReplyStage: FilterCheck = (item, { replyStage }) => {
  if (!replyStage) return true
  if (item.sourceType !== 'review') return false
  const listed = new Set(unbrandAll(replyStage.reviewIds)).has(item.sourceId)
  return listed === (replyStage.match === 'include')
}

const matchesQuery: FilterCheck = (item, { q }) =>
  !q || (item.snippet ?? '').toLocaleLowerCase().includes(q.toLocaleLowerCase())

const matchesAttention: FilterCheck = (item, { attention }) => {
  if (!attention?.length) return true
  const level = effectivePriorityOf(item)
  return level !== null && attention.includes(level)
}

const matchesEscalation: FilterCheck = (item, { isEscalated }) => {
  if (isEscalated === undefined) return true
  const active = item.isEscalated && item.escalationResolvedAt === null
  return isEscalated ? active : !item.isEscalated
}

const matchesFields: FilterCheck = (item, filters) =>
  (!filters.propertyId || item.propertyId === filters.propertyId) &&
  (!filters.propertyIds || filters.propertyIds.includes(item.propertyId)) &&
  (!filters.sourceType || item.sourceType === filters.sourceType) &&
  (!filters.assignedTo || item.assignedTo === filters.assignedTo) &&
  (!filters.platform || item.platform === filters.platform) &&
  (!filters.sourceScopes || matchesSourceScopes(item, filters.sourceScopes))

const FILTER_CHECKS: ReadonlyArray<FilterCheck> = [
  matchesStatus,
  matchesFields,
  matchesRating,
  matchesReplyStage,
  matchesQuery,
  matchesAttention,
  matchesEscalation,
]

const matchesFilters = (item: InboxItem, filters: InboxFilters): boolean =>
  FILTER_CHECKS.every((check) => check(item, filters))

const refuse = (what: string) => async (): Promise<never> => {
  throw new Error(`${what} runs on the server and is not available in Storybook`)
}

export type StoryOnlyInboxFake = InboxRepository & { items: InboxItem[] }

export function createStoryOnlyInboxRepo(): StoryOnlyInboxFake {
  const items: InboxItem[] = []
  const inOrg = (orgId: string) => items.filter((i) => i.organizationId === orgId)
  const matching = (filters: InboxFilters, orgId: string) =>
    inOrg(orgId).filter((item) => matchesFilters(item, filters))
  const scoped = (
    orgId: string,
    propertyIds: ReadonlyArray<string> | undefined,
    sourceScopes: SourceScopes,
  ) =>
    inOrg(orgId).filter(
      (i) =>
        (!propertyIds || propertyIds.includes(i.propertyId)) &&
        matchesSourceScopes(i, sourceScopes),
    )

  const repo: InboxRepository = {
    findById: async (id, orgId) =>
      items.find((i) => i.id === id && i.organizationId === orgId) ?? null,
    findByIds: async (ids, orgId) =>
      inOrg(orgId).filter((i) => unbrandAll(ids).includes(i.id as string)),
    findBySource: async (sourceType, sourceId, orgId) =>
      inOrg(orgId).find((i) => i.sourceType === sourceType && i.sourceId === sourceId) ??
      null,
    findActiveReviewItemIds: refuse('The projection rebuild'),
    findFilteredPaginated: async (filters, orgId, cursor, limit = 50) => {
      const direction = filters.sort === 'oldest' ? 1 : -1
      let filtered = matching(filters, orgId).sort(
        (a, b) =>
          direction * (a.sourceDate.getTime() - b.sourceDate.getTime()) ||
          direction * (a.id as string).localeCompare(b.id as string),
      )
      const totalCount = filtered.length
      if (cursor) {
        const at = filtered.findIndex(
          (i) =>
            i.sourceDate.getTime() === cursor.sourceDate.getTime() && i.id === cursor.id,
        )
        filtered = at >= 0 ? filtered.slice(at + 1) : []
      }
      const overflow = filtered.slice(0, limit + 1)
      const page = overflow.slice(0, limit)
      const last = page[page.length - 1]
      return {
        items: page,
        nextCursor:
          overflow.length > limit && last
            ? { sourceDate: last.sourceDate, id: last.id }
            : null,
        totalCount,
      }
    },
    countFiltered: async (filters, orgId) => matching(filters, orgId).length,
    countFilteredByProperty: async (filters, orgId) => {
      const counts = new Map<InboxItem['propertyId'], number>()
      for (const item of matching(filters, orgId)) {
        counts.set(item.propertyId, (counts.get(item.propertyId) ?? 0) + 1)
      }
      return [...counts].map(([propertyId, count]) => ({ propertyId, count }))
    },
    stampReplyMilestones: refuse('Reply milestone stamping'),
    countByStatus: async (orgId, status, propertyIds, sourceScopes) =>
      scoped(orgId, propertyIds, sourceScopes).filter((i) => i.status === status).length,
    countEscalatedActive: async (orgId, propertyIds, sourceScopes) =>
      scoped(orgId, propertyIds, sourceScopes).filter(
        (i) => i.isEscalated && i.escalationResolvedAt === null,
      ).length,
    countOpenSince: async (orgId, since, propertyIds, sourceScopes) =>
      scoped(orgId, propertyIds, sourceScopes).filter(
        (i) =>
          i.status === 'open' && (!since || i.createdAt.getTime() >= since.getTime()),
      ).length,
    scanReviewItems: refuse('The projection rebuild'),
    findDetailById: async (id, orgId) => {
      const item = items.find((i) => i.id === id && i.organizationId === orgId)
      if (!item) return null
      const isReview = item.sourceType === 'review'
      return {
        item,
        reviewText: isReview ? 'Test review text' : null,
        reviewTranslatedText: null,
        reviewerProfilePhotoUrl: null,
        googleReviewUrl: null,
        reviewContentStatus: isReview ? ('available' as const) : null,
        reviewRating: isReview ? STORY_REVIEW_RATING : null,
        feedbackComment: isReview ? null : 'Test feedback comment',
        feedbackRatingValue: isReview ? null : item.rating,
      }
    },
  }
  return { ...repo, items }
}

type PriorityWrite = Readonly<{
  managerPriority: InboxPriority | null
  managerPrioritySetBy: UserId | null
  managerPrioritySetAt: Date | null
}>

export function createStoryOnlyInboxCommandStore(deps: {
  repo: StoryOnlyInboxFake
  noteRepo: InboxNoteRepository
}): InboxCommandStore {
  const write = (
    id: InboxItem['id'],
    orgId: InboxItem['organizationId'],
    fields: Partial<InboxItem> | ((stamp: Date) => Partial<InboxItem>),
    now = new Date(),
  ): InboxItem => {
    const at = deps.repo.items.findIndex((i) => i.id === id && i.organizationId === orgId)
    const current = deps.repo.items[at]
    if (!current) throw new Error('not found')
    const saved = {
      ...current,
      ...(typeof fields === 'function' ? fields(now) : fields),
      commandRevision: nextCommandRevision(current),
      updatedAt: now,
    }
    deps.repo.items[at] = saved
    return saved
  }

  return {
    releaseAssignmentsForUser: async () => ({ released: 0 }),
    releaseIneligibleAssignmentsForUser: async () => ({ released: 0 }),
    createItem: async (item) => {
      const existing = await deps.repo.findBySource(
        item.sourceType,
        item.sourceId as string,
        item.organizationId,
      )
      if (existing) return { item: existing, created: false }
      const created = {
        ...item,
        managerPriority: null,
        managerPrioritySetBy: null,
        managerPrioritySetAt: null,
      }
      deps.repo.items.push(created)
      return { item: created, created: true }
    },
    createReviewItemAnsweredOnGoogle: refuse('Google reply observation'),
    reopenReviewCycle: async (command) =>
      write(
        command.item.id,
        command.item.organizationId,
        { status: 'open', closedAt: null },
        command.now,
      ),
    bulkUpdateStatus: async (items, perItemEvents) => {
      const results = []
      for (const [index, item] of items.entries()) {
        const event = perItemEvents[index]
        if (!event) continue
        write(
          item.id,
          item.organizationId,
          {
            status: event.newStatus,
            ...timestampFieldsForStatus(event.newStatus, event.occurredAt),
          },
          event.occurredAt,
        )
        results.push({ inboxItemId: item.id, outcome: 'reopened' as const })
      }
      return { updated: results.length, results }
    },
    bulkAssign: async (command) => {
      const results = []
      const transitions = []
      for (const item of command.items) {
        if (item.assignedTo === command.assignedTo) {
          results.push({ inboxItemId: item.id, outcome: 'unchanged' as const })
          continue
        }
        write(
          item.id,
          item.organizationId,
          { assignedTo: command.assignedTo },
          command.occurredAt,
        )
        const outcome =
          command.assignedTo === null
            ? ('released' as const)
            : item.assignedTo === null
              ? ('assigned' as const)
              : ('reassigned' as const)
        results.push({ inboxItemId: item.id, outcome })
        transitions.push({
          inboxItemId: item.id,
          propertyId: item.propertyId,
          previousAssignee: item.assignedTo,
          nextAssignee: command.assignedTo,
        })
      }
      return { updated: transitions.length, results }
    },
    assign: async (item, updates, _event, now) =>
      write(item.id, item.organizationId, { assignedTo: updates.assignedTo }, now),
    escalate: async (item, updates, _event, now) =>
      write(
        item.id,
        item.organizationId,
        (stamp) => ({
          isEscalated: true,
          escalatedAt: stamp,
          escalatedBy: updates.escalatedBy,
          escalationResolvedAt: null,
          escalationResolvedBy: null,
        }),
        now,
      ),
    setPriority: async (item, updates, _event, now) => {
      const stamp = now ?? new Date()
      const priority: PriorityWrite = {
        managerPriority: updates.priority,
        managerPrioritySetBy: updates.priority === null ? null : updates.setBy,
        managerPrioritySetAt: updates.priority === null ? null : stamp,
      }
      return write(item.id, item.organizationId, priority, stamp)
    },
    resolveEscalation: async (item, updates, _event, now) =>
      write(
        item.id,
        item.organizationId,
        (stamp) => ({
          isEscalated: false,
          escalationResolvedAt: stamp,
          escalationResolvedBy: updates.resolvedBy,
        }),
        now,
      ),
    addNote: async (item, note) => {
      write(item.id, item.organizationId, { assignedTo: item.assignedTo }, note.createdAt)
      return deps.noteRepo.create(note, note.organizationId)
    },
    applySourceCreatedOnce: refuse('Source event consumption'),
    applyReviewProjectionOnce: refuse('Source event consumption'),
    applySourceWithdrawnOnce: refuse('Source event consumption'),
    applyReviewSourceTransitionedOnce: refuse('Source event consumption'),
    applyReplyObservedOnce: refuse('Source event consumption'),
    recordReceipt: refuse('Delivery receipts'),
    settleSupersededDelivery: async () => undefined,
  }
}
