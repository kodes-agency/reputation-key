// Inbox use-case wiring and the request capability projection.

import type { InboxRepository } from '../reputation/inbox/inbox-repository.port.server'
import type { InboxNoteRepository } from '../reputation/inbox/inbox-note-repository.port.server'
import type { InboxViewRepository } from '../reputation/inbox/inbox-view-repository.port.server'
import type { InboxCommandStore } from '../reputation/inbox/command-store.port.server'
import type { ReviewHandlingCycleStore } from '../reputation/inbox/review-handling-cycle-store.port.server'
import type { FeedbackHandlingStore } from '../reputation/inbox/feedback-handling-store.port.server'
import type { ResponseTargetStore } from '../reputation/response-targets/store.port.server'
import type { ResponseTargetPolicyStore } from '../reputation/response-targets/policy.store.port.server'
import type { ReviewResponseTargetAuthorityPort } from '../reputation/inbox/review-response-target-authority.port.server'
import type { ReviewSourceLookupPort } from '../reputation/inbox/review-source-lookup.port.server'
import type { ReplyLookupPort } from '../reputation/inbox/reply-lookup.port.server'
import type { AiReviewInsightsPort } from '../reputation/inbox/ai-review-insights.port.server'
import type { PropertyLookupPort } from '../reputation/inbox/property-lookup.port.server'
import type { StaffPublicApi } from '#/contexts/identity/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { InboxPublicApi } from './application/public-api'
import { updateInboxStatus } from '#/contexts/reputation/inbox/update-inbox-status.server'
import { bulkUpdateInboxStatus } from '#/contexts/reputation/inbox/bulk-update-inbox-status.server'
import { bulkAssignInboxItems } from '../reputation/inbox/bulk-assign-inbox-items.server'
import { escalateInboxItem } from '../reputation/inbox/escalate-inbox-item.server'
import { resolveEscalation } from '../reputation/inbox/resolve-escalation.server'
import { setInboxItemPriority } from '../reputation/inbox/set-inbox-item-priority.server'
import { assignInboxItem } from '../reputation/inbox/assign-inbox-item.server'
import { getInboxItems } from '../reputation/inbox/get-inbox-items.server'
import { addInboxNote } from '../reputation/inbox/add-inbox-note.server'
import { getLastVisitCount } from '../reputation/inbox/get-last-visit-count.server'
import { stampLastInboxView } from '../reputation/inbox/stamp-last-inbox-view.server'
import { getInboxItemDetail } from '../reputation/inbox/get-inbox-item-detail.server'
import { getInboxQueueCounts } from '../reputation/inbox/get-inbox-queue-counts.server'
import { getInboxPropertyCounts } from '../reputation/inbox/get-inbox-property-counts.server'
import { getReviewInboxItemIds } from '../reputation/inbox/get-review-inbox-item-ids.server'
import { getInboxNotes } from '../reputation/inbox/get-inbox-notes.server'
import { getInboxItemHistory } from '../reputation/inbox/get-inbox-item-history.server'
import { rebuildInboxProjection } from '#/contexts/reputation/inbox/rebuild-inbox-projection.server'
import { markFeedbackHandled } from '../reputation/inbox/mark-feedback-handled.server'
import { correctFeedbackHandlingOutcome } from '../reputation/inbox/correct-feedback-handling-outcome.server'
import {
  getInboxResponseTarget,
  getGoogleReviewTargetAnalytics,
  getPrivateFeedbackTargetAnalytics,
  getResponseTargetPolicySettings,
} from '../reputation/response-targets/get-response-targets.server'
import { setResponseTargetPolicy } from '../reputation/response-targets/set-response-target-policy.server'
import { releaseDueResponseTargetReminders } from '../reputation/response-targets/release-reminders.server'
import { checkInboxReviewOnGoogle } from '../reputation/inbox/check-inbox-review-on-google.server'
import type { InboxActorDirectory } from '../reputation/inbox/inbox-actor-directory.port.server'
import type { InboxHistoryRepository } from '../reputation/inbox/inbox-history-repository.port.server'
import type { ReplyObservationAuthorityPort } from '../reputation/inbox/review-reply-observation-authority.port.server'
import type { GoogleReviewCheckPort } from '../reputation/inbox/google-review-check.port.server'
import type { GoogleCheckRateLimitPort } from '../reputation/inbox/google-check-rate-limit.port.server'
import { inboxItemId, inboxNoteId } from '#/shared/domain/ids'

type WireInput = Readonly<{
  inboxRepo: InboxRepository
  inboxNoteRepo: InboxNoteRepository
  inboxHistoryRepo: InboxHistoryRepository
  inboxViewRepo: InboxViewRepository
  commandStore: InboxCommandStore
  handlingCycleStore: ReviewHandlingCycleStore
  feedbackHandlingStore: FeedbackHandlingStore
  responseTargetStore: ResponseTargetStore
  responseTargetPolicyStore: ResponseTargetPolicyStore
  responseTargetAuthority: ReviewResponseTargetAuthorityPort
  reviewSourceLookup: ReviewSourceLookupPort
  replyLookup: ReplyLookupPort
  replyObservationAuthority: ReplyObservationAuthorityPort
  googleReviewCheck: GoogleReviewCheckPort
  googleCheckRateLimit: GoogleCheckRateLimitPort
  aiInsights?: AiReviewInsightsPort
  propertyLookup?: PropertyLookupPort
  staffPublicApi: StaffPublicApi
  actorDirectory: InboxActorDirectory
  logger: LoggerPort
  clock: () => Date
  idGen: () => string
}>

export function wireUseCases(input: WireInput) {
  return {
    updateInboxStatus: updateInboxStatus({
      repo: input.inboxRepo,
      commandStore: input.commandStore,
      cycleStore: input.handlingCycleStore,
      reviewSourceLookup: input.reviewSourceLookup,
      responseTargetAuthority: input.responseTargetAuthority,
      clock: input.clock,
      staffPublicApi: input.staffPublicApi,
    }),
    bulkUpdateInboxStatus: bulkUpdateInboxStatus({
      repo: input.inboxRepo,
      commandStore: input.commandStore,
      reviewSourceLookup: input.reviewSourceLookup,
      responseTargetAuthority: input.responseTargetAuthority,
      clock: input.clock,
      idGen: input.idGen,
      staffPublicApi: input.staffPublicApi,
      logger: input.logger,
    }),
    bulkAssignInboxItems: bulkAssignInboxItems({
      repo: input.inboxRepo,
      commandStore: input.commandStore,
      clock: input.clock,
      idGen: input.idGen,
      staffPublicApi: input.staffPublicApi,
    }),
    escalateInboxItem: escalateInboxItem({
      repo: input.inboxRepo,
      commandStore: input.commandStore,
      clock: input.clock,
      staffPublicApi: input.staffPublicApi,
    }),
    resolveEscalation: resolveEscalation({
      repo: input.inboxRepo,
      commandStore: input.commandStore,
      clock: input.clock,
      staffPublicApi: input.staffPublicApi,
    }),
    setInboxItemPriority: setInboxItemPriority({
      repo: input.inboxRepo,
      commandStore: input.commandStore,
      clock: input.clock,
      staffPublicApi: input.staffPublicApi,
    }),
    assignInboxItem: assignInboxItem({
      repo: input.inboxRepo,
      commandStore: input.commandStore,
      clock: input.clock,
      staffPublicApi: input.staffPublicApi,
    }),
    getInboxItems: getInboxItems({
      repo: input.inboxRepo,
      staffPublicApi: input.staffPublicApi,
      clock: input.clock,
      replyLookup: input.replyLookup,
      viewRepo: input.inboxViewRepo,
    }),
    addInboxNote: addInboxNote({
      repo: input.inboxRepo,
      commandStore: input.commandStore,
      idGen: () => inboxNoteId(input.idGen()),
      clock: input.clock,
      staffPublicApi: input.staffPublicApi,
    }),
    getLastVisitCount: getLastVisitCount({
      repo: input.inboxRepo,
      viewRepo: input.inboxViewRepo,
      staffPublicApi: input.staffPublicApi,
    }),
    stampLastInboxView: stampLastInboxView({
      viewRepo: input.inboxViewRepo,
      clock: input.clock,
    }),
    getInboxItemDetail: getInboxItemDetail({
      repo: input.inboxRepo,
      staffPublicApi: input.staffPublicApi,
      replyLookup: input.replyLookup,
      propertyLookup: input.propertyLookup,
      aiInsights: input.aiInsights,
      feedbackHandlingStore: input.feedbackHandlingStore,
      responseTargetStore: input.responseTargetStore,
      clock: input.clock,
    }),
    checkInboxReviewOnGoogle: checkInboxReviewOnGoogle({
      repo: input.inboxRepo,
      staffPublicApi: input.staffPublicApi,
      googleReviewCheck: input.googleReviewCheck,
      replyLookup: input.replyLookup,
      rateLimit: input.googleCheckRateLimit,
      logger: input.logger,
    }),
    getInboxNotes: getInboxNotes({
      noteRepo: input.inboxNoteRepo,
      repo: input.inboxRepo,
      staffPublicApi: input.staffPublicApi,
      actorDirectory: input.actorDirectory,
    }),
    getInboxItemHistory: getInboxItemHistory({
      historyRepo: input.inboxHistoryRepo,
      repo: input.inboxRepo,
      staffPublicApi: input.staffPublicApi,
      actorDirectory: input.actorDirectory,
    }),
    getInboxQueueCounts: getInboxQueueCounts({
      repo: input.inboxRepo,
      staffPublicApi: input.staffPublicApi,
      replyLookup: input.replyLookup,
    }),
    getInboxPropertyCounts: getInboxPropertyCounts({
      repo: input.inboxRepo,
      staffPublicApi: input.staffPublicApi,
      replyLookup: input.replyLookup,
    }),
    getReviewInboxItemIds: getReviewInboxItemIds({
      repo: input.inboxRepo,
      staffPublicApi: input.staffPublicApi,
    }),
    rebuildInboxProjection: rebuildInboxProjection({
      repo: input.inboxRepo,
      commandStore: input.commandStore,
      reviewSourceLookup: input.reviewSourceLookup,
      replyLookup: input.replyLookup,
      replyObservationAuthority: input.replyObservationAuthority,
      idGen: () => inboxItemId(input.idGen()),
      clock: input.clock,
      logger: input.logger,
    }),
    markFeedbackHandled: markFeedbackHandled({
      repo: input.inboxRepo,
      store: input.feedbackHandlingStore,
      staffPublicApi: input.staffPublicApi,
      clock: input.clock,
      idGen: input.idGen,
    }),
    correctFeedbackHandlingOutcome: correctFeedbackHandlingOutcome({
      repo: input.inboxRepo,
      store: input.feedbackHandlingStore,
      staffPublicApi: input.staffPublicApi,
      clock: input.clock,
      idGen: input.idGen,
    }),
    getInboxResponseTarget: getInboxResponseTarget({
      repo: input.inboxRepo,
      targetStore: input.responseTargetStore,
      staffPublicApi: input.staffPublicApi,
      clock: input.clock,
    }),
    getPrivateFeedbackTargetAnalytics: getPrivateFeedbackTargetAnalytics({
      targetStore: input.responseTargetStore,
      staffPublicApi: input.staffPublicApi,
      clock: input.clock,
    }),
    getGoogleReviewTargetAnalytics: getGoogleReviewTargetAnalytics({
      targetStore: input.responseTargetStore,
      staffPublicApi: input.staffPublicApi,
      clock: input.clock,
    }),
    getResponseTargetPolicySettings: getResponseTargetPolicySettings({
      policyStore: input.responseTargetPolicyStore,
    }),
    setResponseTargetPolicy: setResponseTargetPolicy({
      store: input.responseTargetPolicyStore,
      clock: input.clock,
    }),
    releaseDueResponseTargetReminders: releaseDueResponseTargetReminders({
      targetStore: input.responseTargetStore,
      replyLookup: input.replyLookup,
      googleReviewCheck: input.googleReviewCheck,
      clock: input.clock,
      logger: input.logger,
    }),
  } as const
}

/**
 * The request-facing Inbox capabilities, projected from the wired use cases.
 * The composition root and the in-memory Storybook container both expose
 * exactly this set, so a request capability cannot reach one and not the other.
 */
export function projectInboxRequestApi(
  useCases: ReturnType<typeof wireUseCases>,
  responseTargetStore: Pick<ResponseTargetStore, 'getGoogleReviewTargetCountsByProperty'>,
): InboxPublicApi {
  return Object.freeze({
    updateInboxStatus: useCases.updateInboxStatus,
    bulkUpdateInboxStatus: useCases.bulkUpdateInboxStatus,
    bulkAssignInboxItems: useCases.bulkAssignInboxItems,
    escalateInboxItem: useCases.escalateInboxItem,
    resolveEscalation: useCases.resolveEscalation,
    setInboxItemPriority: useCases.setInboxItemPriority,
    assignInboxItem: useCases.assignInboxItem,
    getInboxItems: useCases.getInboxItems,
    addInboxNote: useCases.addInboxNote,
    getLastVisitCount: useCases.getLastVisitCount,
    stampLastInboxView: useCases.stampLastInboxView,
    getInboxItemDetail: useCases.getInboxItemDetail,
    checkInboxReviewOnGoogle: useCases.checkInboxReviewOnGoogle,
    getInboxNotes: useCases.getInboxNotes,
    getInboxItemHistory: useCases.getInboxItemHistory,
    getInboxQueueCounts: useCases.getInboxQueueCounts,
    getInboxPropertyCounts: useCases.getInboxPropertyCounts,
    getReviewInboxItemIds: useCases.getReviewInboxItemIds,
    markFeedbackHandled: useCases.markFeedbackHandled,
    correctFeedbackHandlingOutcome: useCases.correctFeedbackHandlingOutcome,
    getGoogleReviewTargetAnalytics: useCases.getGoogleReviewTargetAnalytics,
    getGoogleReviewTargetCountsByProperty:
      responseTargetStore.getGoogleReviewTargetCountsByProperty,
    getPrivateFeedbackTargetAnalytics: useCases.getPrivateFeedbackTargetAnalytics,
    getResponseTargetPolicySettings: useCases.getResponseTargetPolicySettings,
    setResponseTargetPolicy: useCases.setResponseTargetPolicy,
  })
}
