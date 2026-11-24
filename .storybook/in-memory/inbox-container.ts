// Browser-safe in-memory inbox container for Storybook.
// Wires the REAL inbox use-cases (wireUseCases) against in-memory repos + noop
// ports, so stories exercise actual domain logic — filtering, pagination,
// status transitions — with no DB/network. Scope: synchronous use-case logic +
// synchronous event handlers only; async job pipelines run server-side.
//
// This module lives outside src/components, so the boundary gate doesn't scan
// it; it imports use-cases + in-memory doubles that are verified browser-safe.
import {
  projectInboxRequestApi,
  wireUseCases,
} from '#/contexts/reputation/build-inbox-use-cases'
import type { InboxPublicApi } from '#/contexts/reputation/public-api'
import {
  createStoryOnlyInboxCommandStore,
  createStoryOnlyInboxRepo,
} from './story-only-inbox-fake'
import {
  organizationId,
  userId,
  propertyId,
  inboxItemId,
  reviewId,
  feedbackId,
} from '#/shared/domain/ids'
import type { InboxNoteRepository } from '#/contexts/reputation/inbox/inbox-note-repository.port.server'
import type { InboxViewRepository } from '#/contexts/reputation/inbox/inbox-view-repository.port.server'
import type { ReplyLookupPort } from '#/contexts/reputation/inbox/reply-lookup.port.server'
import type { ReviewSourceLookupPort } from '#/contexts/reputation/inbox/review-source-lookup.port.server'
import type { ReviewResponseTargetAuthorityPort } from '#/contexts/reputation/inbox/review-response-target-authority.port.server'
import type { ReviewHandlingCycleStore } from '#/contexts/reputation/inbox/review-handling-cycle-store.port.server'
import type { FeedbackHandlingStore } from '#/contexts/reputation/inbox/feedback-handling-store.port.server'
import type { ResponseTargetStore } from '#/contexts/reputation/response-targets/store.port.server'
import type { ResponseTargetPolicyStore } from '#/contexts/reputation/response-targets/policy.store.port.server'
import type { InboxHistoryRepository } from '#/contexts/reputation/inbox/inbox-history-repository.port.server'
import type { InboxActorDirectory } from '#/contexts/reputation/inbox/inbox-actor-directory.port.server'
import type { StaffPublicApi } from '#/contexts/identity/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { InboxItem, InboxNote } from '#/contexts/reputation/domain/inbox-types'

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

function createInMemoryNoteRepo(): InboxNoteRepository & {
  notes: InboxNote[]
  add: (note: InboxNote) => InboxNote
} {
  const notes: InboxNote[] = []
  return {
    notes,
    findByInboxItemId: async (id, orgId) =>
      notes.filter((n) => n.inboxItemId === id && n.organizationId === orgId),
    add: (note) => {
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
  getGoogleReplyHeadsByReviewIds: async () => new Map(),
  getReplyStatesByReviewIds: async () => new Map(),
  findReviewIdsByReplyStage: async () => ({ awaiting: [], waiting: [] }),
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
  getGoogleReviewTargetCountsByProperty: async ({ propertyIds }) =>
    new Map(propertyIds.map((id) => [id, { activeCount: 0, overdueCount: 0 }])),
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
  listDueReminderCandidates: async () => [],
  releaseReminderSlot: async () => 'skipped',
  cancelArchivedPropertyRemindersOnce: async () => 'obsolete',
}

const emptyResponseTargetPolicyStore: ResponseTargetPolicyStore = {
  getPolicySettings: async (_organizationId, requestedPropertyId) => ({
    organization: {
      googleReviewResponse: {
        targetKind: 'google_review_response',
        durationMinutes: 2_880,
        policySource: 'builtin_default',
        policyVersion: null,
        lowRating: null,
      },
      privateFeedbackHandling: {
        targetKind: 'private_feedback_handling',
        durationMinutes: 2_880,
        policySource: 'builtin_default',
        policyVersion: null,
        lowRating: null,
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
  const inboxRepo = createStoryOnlyInboxRepo()
  const inboxNoteRepo = createInMemoryNoteRepo()
  const inboxViewRepo = createInMemoryViewRepo()
  let clockNow = new Date('2025-01-15T12:00:00Z')

  const useCases = wireUseCases({
    inboxRepo,
    inboxNoteRepo,
    inboxHistoryRepo: emptyInboxHistoryRepo,
    inboxViewRepo,
    actorDirectory: storybookActorDirectory,
    commandStore: createStoryOnlyInboxCommandStore({
      repo: inboxRepo,
      noteRepo: inboxNoteRepo,
    }),
    handlingCycleStore: emptyHandlingCycleStore,
    feedbackHandlingStore: emptyFeedbackHandlingStore,
    responseTargetStore: emptyResponseTargetStore,
    responseTargetPolicyStore: emptyResponseTargetPolicyStore,
    reviewSourceLookup: noopReviewSourceLookup,
    responseTargetAuthority: noopResponseTargetAuthority,
    replyLookup: noopReplyLookup,
    // Storybook projects no Google reply observations, so no permit is current.
    replyObservationAuthority: { withExactCurrent: async () => ({ status: 'obsolete' }) },
    // Storybook has no Google provider; its reminder release never runs.
    googleReviewCheck: {
      check: async () => ({ status: 'not_checkable', reason: 'no_provider' }),
    },
    // Storybook never reaches Google (`googleReviewCheck` above); stories stub
    // the check function itself.
    googleCheckRateLimit: { consume: async () => 'allowed' },
    staffPublicApi: noopStaffApi,
    logger: noopLogger,
    clock: () => clockNow,
    idGen: () => crypto.randomUUID(),
  })
  const inboxPublicApi: InboxPublicApi = projectInboxRequestApi(
    useCases,
    emptyResponseTargetStore,
  )

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
