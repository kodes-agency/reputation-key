// Inbox context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns segregated request, lifecycle, maintenance, and worker capabilities;
// persistence details remain context-internal.
//
// Runtime contribution exposed to the composition root:
//   - worker.registerOutboxConsumers — BQR-2.2/2.4 durable consumer
//     registration; the worker calls it before optional durable dispatch start.

import type { Database } from '#/shared/db'
import type { ConsumerRegistry } from '#/shared/outbox'
import {
  createInboxAssignmentRuntime,
  type InboxAssignmentRuntime,
} from './application/inbox-assignment-runtime'
import type { EventBus } from '#/shared/events/event-bus'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { CutoverFamily, CutoverState } from '#/shared/outbox/cutover-flags'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { InboxPublicApi } from './application/public-api'
import type {
  ReviewReplyObservationAuthority,
  ReviewSourceTransitionAuthority,
} from '#/contexts/review/application/public-api'
import { inboxItemId } from '#/shared/domain/ids'
import type { InboxRepository } from './application/ports/inbox.repository'
import type { InboxNoteRepository } from './application/ports/inbox-note.repository'
import type { InboxViewRepository } from './application/ports/inbox-view.repository'
import type { InboxCommandStore } from './application/ports/inbox-command-store.port'
import type { ReviewHandlingCycleStore } from './application/ports/review-handling-cycle.store'
import type { FeedbackHandlingStore } from './application/ports/feedback-handling.store'
import type { ResponseTargetStore } from './application/ports/response-target.store'
import type { ResponseTargetPolicyStore } from './application/ports/response-target-policy.store'
import type { ReviewLookupPort } from './application/ports/review-lookup.port'
import type { ReviewSourceLookupPort } from './application/ports/review-source-lookup.port'
import type { FeedbackLookupPort } from './application/ports/feedback-lookup.port'
import type { PropertyLookupPort } from './application/ports/property-lookup.port'
import type { ReplyLookupPort } from './application/ports/reply-lookup.port'
import type { AiReviewInsightsPort } from './application/ports/ai-review-insights.port'
import type {
  FeedbackLookupSource,
  PropertyLookupSource,
  ReplyLookupSource,
  ReviewSourceLookupSource,
} from './application/ports/lookup-sources.port'
import type { CreateInboxItem } from './application/use-cases/create-inbox-item'
import type { UpdateInboxStatus } from './application/use-cases/update-inbox-status'
import type { BulkUpdateInboxStatus } from './application/use-cases/bulk-update-inbox-status'
import type { BulkAssignInboxItems } from './application/use-cases/bulk-assign-inbox-items'
import type { EscalateInboxItem } from './application/use-cases/escalate-inbox-item'
import type { ResolveEscalation } from './application/use-cases/resolve-escalation'
import type { AssignInboxItem } from './application/use-cases/assign-inbox-item'
import type { GetInboxItems } from './application/use-cases/get-inbox-items'
import type { AddInboxNote } from './application/use-cases/add-inbox-note'
import type { GetLastVisitCount } from './application/use-cases/get-last-visit-count'
import type { StampLastInboxView } from './application/use-cases/stamp-last-inbox-view'
import type { GetInboxItemDetail } from './application/use-cases/get-inbox-item-detail'
import type { GetInboxNotes } from './application/use-cases/get-inbox-notes'
import type { GetInboxItemHistory } from './application/use-cases/get-inbox-item-history'
import type { GetInboxFolderCounts } from './application/use-cases/get-folder-counts'
import type { RebuildInboxProjection } from './application/use-cases/rebuild-inbox-projection'
import type { StartReviewHandlingCycle } from './application/use-cases/start-review-handling-cycle'
import type { MarkFeedbackHandled } from './application/use-cases/mark-feedback-handled'
import type { CorrectFeedbackHandlingOutcome } from './application/use-cases/correct-feedback-handling-outcome'
import type {
  GetInboxResponseTarget,
  GetGoogleReviewTargetAnalytics,
  GetPrivateFeedbackTargetAnalytics,
  GetResponseTargetPolicySettings,
} from './application/use-cases/get-response-targets'
import type { SetResponseTargetPolicy } from './application/use-cases/set-response-target-policy'
import type { ReleaseDueResponseTargetReminders } from './application/use-cases/release-response-target-reminders'
import { createInboxRepository } from './infrastructure/repositories/inbox.repository'
import { createInboxNoteRepository } from './infrastructure/repositories/inbox-note.repository'
import { createInboxHistoryRepository } from './infrastructure/repositories/inbox-history.repository'
import { createInboxViewRepository } from './infrastructure/repositories/inbox-view.repository'
import {
  createAtomicInboxCommandStore,
  type InboxCommandAuthority,
} from './infrastructure/inbox-command-store'
import { createReviewHandlingCycleStore } from './infrastructure/review-handling-cycle.store'
import { createFeedbackHandlingStore } from './infrastructure/feedback-handling.store'
import { createResponseTargetStore } from './infrastructure/response-target.store'
import { createResponseTargetPolicyStore } from './infrastructure/response-target-policy.store'
import { registerInboxHandlers } from './infrastructure/event-handlers'
import { registerInboxConsumers } from './infrastructure/outbox-consumers'
import { registerGuestFeedbackConsumer } from './infrastructure/guest-feedback-outbox-consumers'
import { createFeedbackLookupAdapter } from './infrastructure/adapters/feedback-lookup.adapter'
import { createPropertyLookupAdapter } from './infrastructure/adapters/property-lookup.adapter'
import { createReplyLookupAdapter } from './infrastructure/adapters/reply-lookup.adapter'
import { createReviewSourceLookupAdapter } from './infrastructure/adapters/review-source-lookup.adapter'
import { createReplyObservationAuthorityAdapter } from './infrastructure/adapters/reply-observation-authority.adapter'
import { createSourceTransitionAuthorityAdapter } from './infrastructure/adapters/source-transition-authority.adapter'
import { createReviewResponseTargetAuthorityAdapter } from './infrastructure/adapters/review-response-target-authority.adapter'
import type { ReviewResponseTargetAuthority } from '#/contexts/review/application/public-api'
import { createInboxActorDirectoryAdapter } from './infrastructure/adapters/inbox-actor-directory.adapter'
import { createInboxOrganizationExportContributor } from './infrastructure/adapters/inbox-organization-export.adapter'
import { createInboxOrganizationLifecycleContributor } from './infrastructure/adapters/inbox-organization-lifecycle.adapter'
import { wireUseCases } from './build-use-cases'

export type InboxContextBuildInput = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
  idGen: () => string
  cutoverState: (family: CutoverFamily) => CutoverState
  staffPublicApi: StaffPublicApi
  /** BQC-1.4: review.publicApi IS the governed read interface — it satisfies
   * the inbox ReviewLookupPort directly (single rule, one owner). */
  reviewLookup: ReviewLookupPort
  aiInsights?: AiReviewInsightsPort
  /**
   * BQC-5.2: foreign-owned read pieces the inbox build adapts into its lookup
   * ports (guest feedback/rating reads, property names, review reply/metadata
   * reads). Narrow structural contracts — no foreign infrastructure imports.
   */
  sources: Readonly<{
    feedback: FeedbackLookupSource
    property: PropertyLookupSource
    reply: ReplyLookupSource
    review: ReviewSourceLookupSource
    replyObservationAuthority: ReviewReplyObservationAuthority
    responseTargetAuthority: ReviewResponseTargetAuthority
    sourceTransitionAuthority: ReviewSourceTransitionAuthority
  }>
  logger: LoggerPort
  /** Current actor/assignee authority, evaluated inside each command transaction. */
  authorizeCommand: InboxCommandAuthority
}>

type InboxUseCases = Readonly<{
  createInboxItem: CreateInboxItem
  updateInboxStatus: UpdateInboxStatus
  bulkUpdateInboxStatus: BulkUpdateInboxStatus
  bulkAssignInboxItems: BulkAssignInboxItems
  escalateInboxItem: EscalateInboxItem
  resolveEscalation: ResolveEscalation
  assignInboxItem: AssignInboxItem
  getInboxItems: GetInboxItems
  addInboxNote: AddInboxNote
  getLastVisitCount: GetLastVisitCount
  stampLastInboxView: StampLastInboxView
  getInboxItemDetail: GetInboxItemDetail
  getInboxNotes: GetInboxNotes
  getInboxItemHistory: GetInboxItemHistory
  getInboxFolderCounts: GetInboxFolderCounts
  rebuildInboxProjection: RebuildInboxProjection
  startReviewHandlingCycle: StartReviewHandlingCycle
  markFeedbackHandled: MarkFeedbackHandled
  correctFeedbackHandlingOutcome: CorrectFeedbackHandlingOutcome
  getInboxResponseTarget: GetInboxResponseTarget
  getGoogleReviewTargetAnalytics: GetGoogleReviewTargetAnalytics
  getPrivateFeedbackTargetAnalytics: GetPrivateFeedbackTargetAnalytics
  getResponseTargetPolicySettings: GetResponseTargetPolicySettings
  setResponseTargetPolicy: SetResponseTargetPolicy
  releaseDueResponseTargetReminders: ReleaseDueResponseTargetReminders
}>

export type InboxContextApi = Readonly<{
  publicApi: InboxPublicApi
  /** Event and cross-context workflow capabilities. These are deliberately
   * separate from request handlers and operator repair commands. */
  lifecycle: Readonly<{
    createInboxItem: CreateInboxItem
    getInboxResponseTarget: GetInboxResponseTarget
    startReviewHandlingCycle: StartReviewHandlingCycle
  }>
  /**
   * LIF-01: Inbox's own Organization Export contribution. Deliberately NOT part
   * of `publicApi` — no request path may call it, so adding it reaches no new
   * capability. The composition root hands it to Identity's
   * `organizationExport.contributors`, which is the only caller.
   */
  organizationExport: Readonly<{
    contributor: ReturnType<typeof createInboxOrganizationExportContributor>
  }>
  /**
   * LIF-01: Inbox's own Organization lifecycle contribution (closing, purge
   * readiness, purge). Deliberately NOT part of `publicApi` — no request path
   * may call it, so adding it reaches no new capability. The composition root
   * hands it to Identity's lifecycle coordinator, which is the only caller and
   * which is itself composed only under an explicitly reviewed composition.
   */
  organizationLifecycle: Readonly<{
    contributor: ReturnType<typeof createInboxOrganizationLifecycleContributor>
  }>
  /** Bounded operator repair capabilities owned by Inbox. */
  maintenance: Readonly<{
    rebuildInboxProjection: RebuildInboxProjection
  }>
  /** Context-owned worker registration; exposes no repositories or use cases. */
  worker: Readonly<{
    registerOutboxConsumers: (consumerRegistry: ConsumerRegistry) => void
  }>
  /** ARC-03-T12: the named member-authority capability. Replaces the root's
   * `inbox.internal.commandStore` reach-through. */
  assignments: InboxAssignmentRuntime
  /** ARC-03-T12: the scheduled reminder release Inbox contributes to the
   * worker. Replaces the root's `inbox.internal.useCases` destructure. */
  runtime: Readonly<{
    releaseDueResponseTargetReminders: ReleaseDueResponseTargetReminders
  }>
  internal: Readonly<{
    repos: Readonly<{
      inboxRepo: InboxRepository
      inboxNoteRepo: InboxNoteRepository
      inboxViewRepo: InboxViewRepository
      staffPublicApi: StaffPublicApi
    }>
    /** BQC-3.4: atomic state+outbox command store — also drives the durable consumers. */
    commandStore: InboxCommandStore
    handlingCycleStore: ReviewHandlingCycleStore
    feedbackHandlingStore: FeedbackHandlingStore
    responseTargetStore: ResponseTargetStore
    responseTargetPolicyStore: ResponseTargetPolicyStore
    useCases: InboxUseCases
  }>
}>

export const buildInboxContext = (input: InboxContextBuildInput): InboxContextApi => {
  // Cross-context lookup ports — the inbox build adapts the foreign-owned
  // sources (injected structurally) into its own lookup contracts.
  const feedbackLookup: FeedbackLookupPort = createFeedbackLookupAdapter({
    findResponseSnippetsByIds: (ids, orgId) =>
      input.sources.feedback.findResponseSnippetsByIds(ids, orgId),
    findEligibleResponseIds: (orgId, filter) =>
      input.sources.feedback.findEligibleResponseIds(orgId, filter),
    findLegacyFeedbackSnippetsByIds: (ids, orgId) =>
      input.sources.feedback.findLegacyFeedbackSnippetsByIds(ids, orgId),
    findEligibleLegacyFeedbackIds: (orgId, filter) =>
      input.sources.feedback.findEligibleLegacyFeedbackIds(orgId, filter),
  })
  const propertyLookup: PropertyLookupPort = createPropertyLookupAdapter({
    getPropertyName: (orgId, pid) => input.sources.property.getPropertyName(orgId, pid),
    getPropertyNames: (orgId, pids) =>
      input.sources.property.getPropertyNames(orgId, pids),
    getPropertyReplyLanguage: input.sources.property.getPropertyReplyLanguage
      ? (orgId, pid) => input.sources.property.getPropertyReplyLanguage!(orgId, pid)
      : undefined,
  })
  const replyLookup: ReplyLookupPort = createReplyLookupAdapter({
    findByReviewId: (id, orgId) => input.sources.reply.findByReviewId(id, orgId),
    findMilestonesByReviewIds: (ids, orgId) =>
      input.sources.reply.findMilestonesByReviewIds(ids, orgId),
  })
  // BQC-3.4: projection source metadata (review.updated consumer + rebuild).
  const reviewSourceLookup: ReviewSourceLookupPort = createReviewSourceLookupAdapter({
    findById: (id, orgId) => input.sources.review.findById(id, orgId),
    findByIds: (ids, orgId) => input.sources.review.findByIds(ids, orgId),
    findByOrganizationId: (orgId) => input.sources.review.findByOrganizationId(orgId),
    findByPropertyId: (pid, orgId) => input.sources.review.findByPropertyId(pid, orgId),
  })
  const replyObservationAuthority = createReplyObservationAuthorityAdapter(
    input.sources.replyObservationAuthority,
  )
  const responseTargetAuthority = createReviewResponseTargetAuthorityAdapter(
    input.sources.responseTargetAuthority,
  )
  const sourceTransitionAuthority = createSourceTransitionAuthorityAdapter(
    input.sources.sourceTransitionAuthority,
  )

  const inboxRepo = createInboxRepository(
    input.db,
    {
      reviewLookup: input.reviewLookup,
      feedbackLookup,
      propertyLookup,
      aiInsights: input.aiInsights,
    },
    {
      clock: input.clock,
      logger: input.logger,
    },
  )
  const inboxNoteRepo = createInboxNoteRepository(input.db)
  const inboxHistoryRepo = createInboxHistoryRepository(input.db)
  // IBX-01-T6: bounded actor display-name resolution. Inbox owns the read
  // because the alternative — rendering an eight-character id fragment — is not
  // usable manager history.
  const actorDirectory = createInboxActorDirectoryAdapter(input.db)
  const inboxViewRepo = createInboxViewRepository(input.db, input.clock)

  // BQC-3.4: atomic inbox state + outbox writes for every fact-emitting
  // command. This closes the wiring gap — inbox facts were previously
  // bus-only in production because wireUseCases never received outboxRepo.
  const commandStore = createAtomicInboxCommandStore(
    input.db,
    input.events,
    input.authorizeCommand,
    input.clock,
  )
  const handlingCycleStore = createReviewHandlingCycleStore(input.db)
  const feedbackHandlingStore = createFeedbackHandlingStore(
    input.db,
    input.events,
    input.authorizeCommand,
  )
  const responseTargetStore = createResponseTargetStore(input.db, input.events)
  const responseTargetPolicyStore = createResponseTargetPolicyStore(
    input.db,
    input.events,
  )

  const useCases = wireUseCases({
    inboxRepo,
    inboxNoteRepo,
    inboxHistoryRepo,
    inboxViewRepo,
    actorDirectory,
    commandStore,
    handlingCycleStore,
    feedbackHandlingStore,
    responseTargetStore,
    responseTargetPolicyStore,
    responseTargetAuthority,
    reviewSourceLookup,
    replyLookup,
    propertyLookup,
    staffPublicApi: input.staffPublicApi,
    aiInsights: input.aiInsights,
    logger: input.logger,
    clock: input.clock,
    idGen: input.idGen,
  })
  const publicApi: InboxPublicApi = Object.freeze({
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
    getGoogleReviewTargetCountsByProperty:
      responseTargetStore.getGoogleReviewTargetCountsByProperty,
    getPrivateFeedbackTargetAnalytics: useCases.getPrivateFeedbackTargetAnalytics,
    getResponseTargetPolicySettings: useCases.getResponseTargetPolicySettings,
    setResponseTargetPolicy: useCases.setResponseTargetPolicy,
  })
  const lifecycle = Object.freeze({
    createInboxItem: useCases.createInboxItem,
    getInboxResponseTarget: useCases.getInboxResponseTarget,
    startReviewHandlingCycle: useCases.startReviewHandlingCycle,
  })
  const maintenance = Object.freeze({
    rebuildInboxProjection: useCases.rebuildInboxProjection,
  })

  // Register cross-context event handlers (expand-phase bus dual path)
  registerInboxHandlers({
    events: input.events,
    createInboxItem: lifecycle.createInboxItem,
    repo: inboxRepo,
    commandStore,
    logger: input.logger,
    cutoverState: input.cutoverState,
  })

  // BQR-2.2/2.4: durable consumer registration — inbox's runtime
  // contribution. The worker calls this before optional durable dispatch
  // start; wiring stays a single assignment in the composition root while
  // the deps stay captured here.
  const registerOutboxConsumers = (consumerRegistry: ConsumerRegistry) => {
    registerInboxConsumers(consumerRegistry, {
      commandStore,
      handlingCycleStore,
      replyObservationAuthority,
      responseTargetAuthority,
      sourceTransitionAuthority,
      reviewLookup: input.reviewLookup,
      reviewSourceLookup,
      inboxRepo,
      idGen: () => inboxItemId(input.idGen()),
      clock: input.clock,
      logger: input.logger,
    })
    registerGuestFeedbackConsumer(consumerRegistry, {
      commandStore,
      feedbackLookup,
      inboxRepo,
      idGen: () => inboxItemId(input.idGen()),
      clock: input.clock,
    })
  }

  return {
    publicApi,
    lifecycle,
    organizationExport: Object.freeze({
      contributor: createInboxOrganizationExportContributor(input.db),
    }),
    organizationLifecycle: Object.freeze({
      contributor: createInboxOrganizationLifecycleContributor(input.db),
    }),
    maintenance,
    worker: Object.freeze({ registerOutboxConsumers }),
    assignments: createInboxAssignmentRuntime(commandStore),
    runtime: Object.freeze({
      releaseDueResponseTargetReminders: useCases.releaseDueResponseTargetReminders,
    }),
    internal: {
      repos: {
        inboxRepo,
        inboxNoteRepo,
        inboxViewRepo,
        staffPublicApi: input.staffPublicApi,
      },
      commandStore,
      handlingCycleStore,
      feedbackHandlingStore,
      responseTargetStore,
      responseTargetPolicyStore,
      useCases,
    },
  }
}
