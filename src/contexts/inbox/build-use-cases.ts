// Inbox context — use-case wiring (extracted from build.ts for line-count compliance)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."

import type { InboxRepository } from './application/ports/inbox.repository'
import type { InboxNoteRepository } from './application/ports/inbox-note.repository'
import type { InboxViewRepository } from './application/ports/inbox-view.repository'
import type { InboxCommandStore } from './application/ports/inbox-command-store.port'
import type { ReviewHandlingCycleStore } from './application/ports/review-handling-cycle.store'
import type { FeedbackHandlingStore } from './application/ports/feedback-handling.store'
import type { ResponseTargetStore } from './application/ports/response-target.store'
import type { ResponseTargetPolicyStore } from './application/ports/response-target-policy.store'
import type { ReviewResponseTargetAuthorityPort } from './application/ports/review-response-target-authority.port'
import type { ReviewSourceLookupPort } from './application/ports/review-source-lookup.port'
import type { ReplyLookupPort } from './application/ports/reply-lookup.port'
import type { AiReviewInsightsPort } from './application/ports/ai-review-insights.port'
import type { PropertyLookupPort } from './application/ports/property-lookup.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { InboxContextApi } from './build'
import { createInboxItem as createInboxItemUseCase } from './application/use-cases/create-inbox-item'
import { updateInboxStatus } from './application/use-cases/update-inbox-status'
import { bulkUpdateInboxStatus } from './application/use-cases/bulk-update-inbox-status'
import { bulkAssignInboxItems } from './application/use-cases/bulk-assign-inbox-items'
import { escalateInboxItem } from './application/use-cases/escalate-inbox-item'
import { resolveEscalation } from './application/use-cases/resolve-escalation'
import { assignInboxItem } from './application/use-cases/assign-inbox-item'
import { getInboxItems } from './application/use-cases/get-inbox-items'
import { addInboxNote } from './application/use-cases/add-inbox-note'
import { getLastVisitCount } from './application/use-cases/get-last-visit-count'
import { stampLastInboxView } from './application/use-cases/stamp-last-inbox-view'
import { getInboxItemDetail } from './application/use-cases/get-inbox-item-detail'
import { getInboxFolderCounts } from './application/use-cases/get-folder-counts'
import { getInboxNotes } from './application/use-cases/get-inbox-notes'
import { getInboxItemHistory } from './application/use-cases/get-inbox-item-history'
import { rebuildInboxProjection } from './application/use-cases/rebuild-inbox-projection'
import { startReviewHandlingCycle } from './application/use-cases/start-review-handling-cycle'
import { markFeedbackHandled } from './application/use-cases/mark-feedback-handled'
import { correctFeedbackHandlingOutcome } from './application/use-cases/correct-feedback-handling-outcome'
import {
  getInboxResponseTarget,
  getGoogleReviewTargetAnalytics,
  getPrivateFeedbackTargetAnalytics,
  getResponseTargetPolicySettings,
} from './application/use-cases/get-response-targets'
import { setResponseTargetPolicy } from './application/use-cases/set-response-target-policy'
import { releaseDueResponseTargetReminders } from './application/use-cases/release-response-target-reminders'
import type { InboxActorDirectory } from './application/ports/inbox-actor-directory.port'
import type { InboxHistoryRepository } from './application/ports/inbox-history.repository'
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
  aiInsights?: AiReviewInsightsPort
  propertyLookup?: PropertyLookupPort
  staffPublicApi: StaffPublicApi
  actorDirectory: InboxActorDirectory
  logger: LoggerPort
  clock: () => Date
  idGen: () => string
}>

export function wireUseCases(input: WireInput): InboxContextApi['internal']['useCases'] {
  return {
    createInboxItem: createInboxItemUseCase({
      repo: input.inboxRepo,
      commandStore: input.commandStore,
      idGen: () => inboxItemId(input.idGen()),
      clock: input.clock,
    }),
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
    getInboxFolderCounts: getInboxFolderCounts({
      repo: input.inboxRepo,
      staffPublicApi: input.staffPublicApi,
    }),
    rebuildInboxProjection: rebuildInboxProjection({
      repo: input.inboxRepo,
      commandStore: input.commandStore,
      reviewSourceLookup: input.reviewSourceLookup,
      replyLookup: input.replyLookup,
      idGen: () => inboxItemId(input.idGen()),
      clock: input.clock,
      logger: input.logger,
    }),
    startReviewHandlingCycle: startReviewHandlingCycle({
      inboxRepo: input.inboxRepo,
      cycleStore: input.handlingCycleStore,
      reviewSourceLookup: input.reviewSourceLookup,
      responseTargetAuthority: input.responseTargetAuthority,
      clock: input.clock,
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
      clock: input.clock,
    }),
  }
}
