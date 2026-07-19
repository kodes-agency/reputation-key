// Browser-safe in-memory inbox container for Storybook.
// Wires the REAL inbox use-cases (wireUseCases) against in-memory repos + noop
// ports, so stories exercise actual domain logic — filtering, pagination,
// status transitions — with no DB/network. Scope: synchronous use-case logic +
// synchronous event handlers only; async job pipelines run server-side.
//
// This module lives outside src/components, so the boundary gate doesn't scan
// it; it imports use-cases + in-memory doubles that are verified browser-safe.
import { wireUseCases } from '#/contexts/inbox/build-use-cases'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import { createEventBus } from '#/shared/events/event-bus'
import {
  organizationId,
  userId,
  propertyId,
  inboxItemId,
  reviewId,
  feedbackId,
} from '#/shared/domain/ids'
import type { InboxNoteRepository } from '#/contexts/inbox/application/ports/inbox-note.repository'
import type { InboxViewRepository } from '#/contexts/inbox/application/ports/inbox-view.repository'
import type { ReplyLookupPort } from '#/contexts/inbox/application/ports/reply-lookup.port'
import type { ReviewSourceLookupPort } from '#/contexts/inbox/application/ports/review-source-lookup.port'
import { createSequentialInboxCommandStore } from '#/shared/testing/sequential-inbox-command-store'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { InboxItem, InboxNote } from '#/contexts/inbox/domain/types'

const ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const USER = userId('user-00000000-0000-0000-0000-000000000001')
const PROP = propertyId('prop-00000000-0000-0000-0000-000000000001')

/** Stable ids + an AccountAdmin role (full perms) to seed stories with. */
export const inboxTestIds = {
  ORG,
  USER,
  PROP,
  role: 'AccountAdmin' as const,
}

export function makeInboxItem(opts: {
  id: string
  sourceType: 'review' | 'feedback'
  status?: InboxItem['status']
  isEscalated?: boolean
  rating?: number
}): InboxItem {
  return {
    id: inboxItemId(opts.id),
    organizationId: ORG,
    propertyId: PROP,
    sourceType: opts.sourceType,
    sourceId: opts.sourceType === 'review' ? reviewId(opts.id) : feedbackId(opts.id),
    status: opts.status ?? 'open',
    isEscalated: opts.isEscalated ?? false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    rating: opts.rating ?? 4,
    sourceDate: new Date('2025-01-01'),
    platform: 'google',
    snippet: 'Great service, highly recommend!',
    assignedTo: null,
    reviewerName: 'Jane Doe',
    propertyName: 'Acme Hotel',
    closedAt: null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  }
}

function createInMemoryNoteRepo(): InboxNoteRepository & { notes: InboxNote[] } {
  const notes: InboxNote[] = []
  return {
    notes,
    findByInboxItemId: async (id, orgId) =>
      notes.filter((n) => n.inboxItemId === id && n.organizationId === orgId),
    create: async (note) => {
      notes.push(note)
      return note
    },
  }
}

function createInMemoryViewRepo(): InboxViewRepository {
  let lastView: Date | null = null
  return {
    getLastInboxView: async () => lastView,
    stampLastInboxView: async (_orgId, _userId, now) => {
      lastView = now ?? new Date()
      return lastView
    },
  }
}

const noopStaffApi: StaffPublicApi = {
  // null = AccountAdmin semantics (all properties); PropertyManager role
  // bypasses this call in getInboxItems anyway.
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
}

const noopLogger: LoggerPort = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
}

const noopReplyLookup: ReplyLookupPort = {
  getReplyByReviewId: async () => null,
  getEffectiveReplyByReviewId: async () => null,
  getReplyMilestonesByReviewIds: async () => new Map(),
}

const noopReviewSourceLookup: ReviewSourceLookupPort = {
  getReviewSourceMetaById: async () => null,
  listReviewSources: async () => [],
}

export function createInboxContainer() {
  const inboxRepo = createInMemoryInboxRepo()
  const inboxNoteRepo = createInMemoryNoteRepo()
  const inboxViewRepo = createInMemoryViewRepo()
  const events = createEventBus()
  let clockNow = new Date('2025-01-15T12:00:00Z')

  const useCases = wireUseCases({
    inboxRepo,
    inboxNoteRepo,
    inboxViewRepo,
    commandStore: createSequentialInboxCommandStore({
      repo: inboxRepo,
      noteRepo: inboxNoteRepo,
      events,
    }),
    reviewSourceLookup: noopReviewSourceLookup,
    replyLookup: noopReplyLookup,
    staffPublicApi: noopStaffApi,
    logger: noopLogger,
    clock: () => clockNow,
  })

  return {
    useCases,
    seed(items: ReadonlyArray<InboxItem>) {
      inboxRepo.items.push(...items)
    },
    advanceClock(ms: number) {
      clockNow = new Date(clockNow.getTime() + ms)
    },
  }
}
