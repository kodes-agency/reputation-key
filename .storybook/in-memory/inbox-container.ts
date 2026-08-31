// Browser-safe in-memory inbox container for Storybook.
// Wires the REAL inbox use-cases (wireUseCases) against in-memory repos + noop
// ports, so stories exercise actual domain logic — filtering, pagination,
// status transitions — with no DB/network. Scope: synchronous use-case logic +
// synchronous event handlers only; async job pipelines run server-side.
//
// This module lives outside src/components, so the boundary gate doesn't scan
// it; it imports use-cases + in-memory doubles that are verified browser-safe.
import { wireUseCases } from '#/contexts/inbox/build-use-cases'
import type { InboxPublicApi } from '#/contexts/inbox/application/public-api'
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
import type { ReviewResponseTargetAuthorityPort } from '#/contexts/inbox/application/ports/review-response-target-authority.port'
import type { ReviewHandlingCycleStore } from '#/contexts/inbox/application/ports/review-handling-cycle.store'
import type { FeedbackHandlingStore } from '#/contexts/inbox/application/ports/feedback-handling.store'
import type { ResponseTargetStore } from '#/contexts/inbox/application/ports/response-target.store'
import type { ResponseTargetPolicyStore } from '#/contexts/inbox/application/ports/response-target-policy.store'
import type { InboxHistoryRepository } from '#/contexts/inbox/application/ports/inbox-history.repository'
import type { InboxActorDirectory } from '#/contexts/inbox/application/ports/inbox-actor-directory.port'
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
    commandRevision: 1,
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
      const candidate = now ?? new Date()
      if (lastView === null || candidate.getTime() > lastView.getTime()) {
        lastView = candidate
      }
      return lastView
    },
  }
}

const noopStaffApi: StaffPublicApi = {
  // null = AccountAdmin semantics (all properties); PropertyManager role
  // bypasses this call in getInboxItems anyway.
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

const noopLogger: LoggerPort = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
}

const noopReplyLookup: ReplyLookupPort = {
  getEffectiveReplyByReviewId: async () => null,
  getReplyMilestonesByReviewIds: async () => new Map(),
}

const noopReviewSourceLookup: ReviewSourceLookupPort = {
  getReviewSourceMetaById: async () => null,
  getReviewSourceMetaByIds: async () => [],
  listReviewSources: async () => [],
}

const noopResponseTargetAuthority: ReviewResponseTargetAuthorityPort = {
  withExactCurrent: async () => ({ status: 'obsolete' }),
  withExactCurrentBatch: async () => ({ status: 'obsolete' }),
  withInboxProjection: async () => ({ status: 'obsolete' }),
}

const emptyHandlingCycleStore: ReviewHandlingCycleStore = {
  findHead: async () => null,
  listCycles: async () => [],
  startNext: async () => {
    throw new Error('Handling Cycles are not seeded in this Storybook container')
  },
}

const emptyFeedbackHandlingStore: FeedbackHandlingStore = {
  getState: async () => null,
  markHandled: async () => {
    throw new Error('Feedback Handling Cycles are not seeded in this Storybook container')
  },
  correctOutcome: async () => {
    throw new Error('Feedback Handling Cycles are not seeded in this Storybook container')
  },
}

const emptyResponseTargetStore: ResponseTargetStore = {
  getCycleTarget: async () => null,
  getPrivateFeedbackAnalytics: async () => ({
    targetKind: 'private_feedback_handling',
    measuredCycleCount: 0,
    activeCount: 0,
    currentOverdueCount: 0,
    handledOnTimeCount: 0,
    handledLateCount: 0,
    reopenCount: 0,
    averageTimeToFirstHandlingMinutes: null,
  }),
  getGoogleReviewAnalytics: async () => ({
    targetKind: 'google_review_response',
    measuredCycleCount: 0,
    activeCount: 0,
    currentOverdueCount: 0,
    respondedOnTimeCount: 0,
    respondedLateCount: 0,
    reopenCount: 0,
    historicalOnboardingExcludedCount: 0,
    legacyUnknownExcludedCount: 0,
    averageTimeToResponseMinutes: null,
  }),
  releaseDueReminders: async () => ({ released: 0 }),
}

const emptyResponseTargetPolicyStore: ResponseTargetPolicyStore = {
  getPolicySettings: async (_organizationId, requestedPropertyId) => ({
    organization: {
      googleReviewResponse: {
        targetKind: 'google_review_response',
        durationMinutes: 2_880,
        policySource: 'builtin_default',
        policyVersion: null,
      },
      privateFeedbackHandling: {
        targetKind: 'private_feedback_handling',
        durationMinutes: 2_880,
        policySource: 'builtin_default',
        policyVersion: null,
      },
    },
    privateFeedbackPropertyOverride: requestedPropertyId
      ? {
          propertyId: requestedPropertyId,
          durationMinutes: null,
          policyVersion: null,
          effectiveDurationMinutes: 2_880,
          effectiveSource: 'builtin_default',
        }
      : null,
  }),
  setOrganizationPolicy: async () => {
    throw new Error('Response Target policies are not persisted in Storybook')
  },
  setPrivateFeedbackPropertyOverride: async () => {
    throw new Error('Response Target policies are not persisted in Storybook')
  },
}

/**
 * Storybook renders the manager view, not the manager history: the read model
 * is exercised by its own integration test against a real schema. An empty page
 * is the honest stand-in — never a fabricated story.
 */
const emptyInboxHistoryRepo: InboxHistoryRepository = {
  findByInboxItemId: async () => ({ entries: [], truncated: false }),
}

/** Display names the stories seed, so no story renders a raw id fragment. */
const storybookActorDirectory: InboxActorDirectory = {
  resolveDisplayNames: async (_organizationId, userIds) =>
    new Map(userIds.map((id) => [id, `Manager ${String(id).slice(-4)}`])),
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
    inboxHistoryRepo: emptyInboxHistoryRepo,
    inboxViewRepo,
    actorDirectory: storybookActorDirectory,
    commandStore: createSequentialInboxCommandStore({
      repo: inboxRepo,
      noteRepo: inboxNoteRepo,
      events,
    }),
    handlingCycleStore: emptyHandlingCycleStore,
    feedbackHandlingStore: emptyFeedbackHandlingStore,
    responseTargetStore: emptyResponseTargetStore,
    responseTargetPolicyStore: emptyResponseTargetPolicyStore,
    reviewSourceLookup: noopReviewSourceLookup,
    responseTargetAuthority: noopResponseTargetAuthority,
    replyLookup: noopReplyLookup,
    staffPublicApi: noopStaffApi,
    logger: noopLogger,
    clock: () => clockNow,
    idGen: () => crypto.randomUUID(),
  })
  const inboxPublicApi: InboxPublicApi = Object.freeze({
    updateInboxStatus: useCases.updateInboxStatus,
    bulkUpdateInboxStatus: useCases.bulkUpdateInboxStatus,
    bulkAssignInboxItems: useCases.bulkAssignInboxItems,
    escalateInboxItem: useCases.escalateInboxItem,
    resolveEscalation: useCases.resolveEscalation,
    assignInboxItem: useCases.assignInboxItem,
    getInboxItems: useCases.getInboxItems,
    addInboxNote: useCases.addInboxNote,
    getLastVisitCount: useCases.getLastVisitCount,
    stampLastInboxView: useCases.stampLastInboxView,
    getInboxItemDetail: useCases.getInboxItemDetail,
    getInboxNotes: useCases.getInboxNotes,
    getInboxItemHistory: useCases.getInboxItemHistory,
    getInboxFolderCounts: useCases.getInboxFolderCounts,
    markFeedbackHandled: useCases.markFeedbackHandled,
    correctFeedbackHandlingOutcome: useCases.correctFeedbackHandlingOutcome,
    getGoogleReviewTargetAnalytics: useCases.getGoogleReviewTargetAnalytics,
    getPrivateFeedbackTargetAnalytics: useCases.getPrivateFeedbackTargetAnalytics,
    getResponseTargetPolicySettings: useCases.getResponseTargetPolicySettings,
    setResponseTargetPolicy: useCases.setResponseTargetPolicy,
  })

  return {
    inboxPublicApi,
    readLastInboxView() {
      return inboxViewRepo.getLastInboxView(ORG, USER)
    },
    seed(items: ReadonlyArray<InboxItem>) {
      inboxRepo.items.push(...items)
    },
    advanceClock(ms: number) {
      clockNow = new Date(clockNow.getTime() + ms)
    },
  }
}
