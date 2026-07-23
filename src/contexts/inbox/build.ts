// Inbox context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the inbox context.
//
// Runtime contribution exposed to the composition root:
//   - internal.registerOutboxConsumers — BQR-2.2/2.4 durable consumer
//     registration; the worker calls it before optional durable dispatch start.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { inboxItemId } from '#/shared/domain/ids'
import type { InboxRepository } from './application/ports/inbox.repository'
import type { InboxNoteRepository } from './application/ports/inbox-note.repository'
import type { InboxViewRepository } from './application/ports/inbox-view.repository'
import type { InboxCommandStore } from './application/ports/inbox-command-store.port'
import type { ReviewLookupPort } from './application/ports/review-lookup.port'
import type { ReviewSourceLookupPort } from './application/ports/review-source-lookup.port'
import type { FeedbackLookupPort } from './application/ports/feedback-lookup.port'
import type { PropertyLookupPort } from './application/ports/property-lookup.port'
import type { ReplyLookupPort } from './application/ports/reply-lookup.port'
import type {
  FeedbackLookupSource,
  PropertyLookupSource,
  ReplyLookupSource,
  ReviewSourceLookupSource,
} from './application/ports/lookup-sources.port'
import type { CreateInboxItem } from './application/use-cases/create-inbox-item'
import type { UpdateInboxStatus } from './application/use-cases/update-inbox-status'
import type { BulkUpdateInboxStatus } from './application/use-cases/bulk-update-inbox-status'
import type { EscalateInboxItem } from './application/use-cases/escalate-inbox-item'
import type { ResolveEscalation } from './application/use-cases/resolve-escalation'
import type { AssignInboxItem } from './application/use-cases/assign-inbox-item'
import type { GetInboxItems } from './application/use-cases/get-inbox-items'
import type { AddInboxNote } from './application/use-cases/add-inbox-note'
import type { GetLastVisitCount } from './application/use-cases/get-last-visit-count'
import type { StampLastInboxView } from './application/use-cases/stamp-last-inbox-view'
import type { GetInboxItemDetailUseCase } from './application/use-cases/get-inbox-item-detail'
import type { GetInboxNotesUseCase } from './application/use-cases/get-inbox-notes'
import type { GetInboxFolderCounts } from './application/use-cases/get-folder-counts'
import type { RebuildInboxProjection } from './application/use-cases/rebuild-inbox-projection'
import { createInboxRepository } from './infrastructure/repositories/inbox.repository'
import { createInboxNoteRepository } from './infrastructure/repositories/inbox-note.repository'
import { createInboxViewRepository } from './infrastructure/repositories/inbox-view.repository'
import { createAtomicInboxCommandStore } from './infrastructure/inbox-command-store'
import { registerInboxHandlers } from './infrastructure/event-handlers'
import { registerInboxConsumers } from './infrastructure/outbox-consumers'
import { createFeedbackLookupAdapter } from './infrastructure/adapters/feedback-lookup.adapter'
import { createPropertyLookupAdapter } from './infrastructure/adapters/property-lookup.adapter'
import { createReplyLookupAdapter } from './infrastructure/adapters/reply-lookup.adapter'
import { createReviewSourceLookupAdapter } from './infrastructure/adapters/review-source-lookup.adapter'
import { wireUseCases } from './build-use-cases'

export type InboxContextBuildInput = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
  staffPublicApi: StaffPublicApi
  /** BQC-1.4: review.publicApi IS the governed read interface — it satisfies
   * the inbox ReviewLookupPort directly (single rule, one owner). */
  reviewLookup: ReviewLookupPort
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
  }>
  logger: LoggerPort
}>

export type InboxContextApi = Readonly<{
  publicApi: Record<string, never>
  internal: Readonly<{
    repos: Readonly<{
      inboxRepo: InboxRepository
      inboxNoteRepo: InboxNoteRepository
      inboxViewRepo: InboxViewRepository
      staffPublicApi: StaffPublicApi
    }>
    /** BQC-3.4: atomic state+outbox command store — also drives the durable consumers. */
    commandStore: InboxCommandStore
    /** BQR-2.2/2.4: registers the durable outbox consumers (worker calls this
     * before optional durable dispatch start). Runtime contribution. */
    registerOutboxConsumers: () => void
    useCases: Readonly<{
      createInboxItem: CreateInboxItem
      updateInboxStatus: UpdateInboxStatus
      bulkUpdateInboxStatus: BulkUpdateInboxStatus
      escalateInboxItem: EscalateInboxItem
      resolveEscalation: ResolveEscalation
      assignInboxItem: AssignInboxItem
      getInboxItems: GetInboxItems
      addInboxNote: AddInboxNote
      getLastVisitCount: GetLastVisitCount
      stampLastInboxView: StampLastInboxView
      getInboxItemDetail: GetInboxItemDetailUseCase
      getInboxNotes: GetInboxNotesUseCase
      getInboxFolderCounts: GetInboxFolderCounts
      rebuildInboxProjection: RebuildInboxProjection
    }>
  }>
}>

export const buildInboxContext = (input: InboxContextBuildInput): InboxContextApi => {
  // Cross-context lookup ports — the inbox build adapts the foreign-owned
  // sources (injected structurally) into its own lookup contracts.
  const feedbackLookup: FeedbackLookupPort = createFeedbackLookupAdapter({
    findFeedbackById: (id, orgId) => input.sources.feedback.findFeedbackById(id, orgId),
    findRatingById: (id, orgId) => input.sources.feedback.findRatingById(id, orgId),
  })
  const propertyLookup: PropertyLookupPort = createPropertyLookupAdapter({
    getPropertyName: (orgId, pid) => input.sources.property.getPropertyName(orgId, pid),
    getPropertyNames: (orgId, pids) =>
      input.sources.property.getPropertyNames(orgId, pids),
  })
  const replyLookup: ReplyLookupPort = createReplyLookupAdapter({
    findInternalByReviewId: (id, orgId) =>
      input.sources.reply.findInternalByReviewId(id, orgId),
    findByReviewId: (id, orgId) => input.sources.reply.findByReviewId(id, orgId),
  })
  // BQC-3.4: projection source metadata (review.updated consumer + rebuild).
  const reviewSourceLookup: ReviewSourceLookupPort = createReviewSourceLookupAdapter({
    findById: (id, orgId) => input.sources.review.findById(id, orgId),
    findByOrganizationId: (orgId) => input.sources.review.findByOrganizationId(orgId),
    findByPropertyId: (pid, orgId) => input.sources.review.findByPropertyId(pid, orgId),
  })

  const inboxRepo = createInboxRepository(input.db, {
    reviewLookup: input.reviewLookup,
    feedbackLookup,
    propertyLookup,
  })
  const inboxNoteRepo = createInboxNoteRepository(input.db)
  const inboxViewRepo = createInboxViewRepository(input.db)

  // BQC-3.4: atomic inbox state + outbox writes for every fact-emitting
  // command. This closes the wiring gap — inbox facts were previously
  // bus-only in production because wireUseCases never received outboxRepo.
  const commandStore = createAtomicInboxCommandStore(input.db, input.events)

  const useCases = wireUseCases({
    inboxRepo,
    inboxNoteRepo,
    inboxViewRepo,
    commandStore,
    reviewSourceLookup,
    replyLookup,
    staffPublicApi: input.staffPublicApi,
    logger: input.logger,
    clock: input.clock,
  })

  // Register cross-context event handlers (expand-phase bus dual path)
  registerInboxHandlers({
    events: input.events,
    createInboxItem: useCases.createInboxItem,
    repo: inboxRepo,
  })

  // BQR-2.2/2.4: durable consumer registration — inbox's runtime
  // contribution. The worker calls this before optional durable dispatch
  // start; wiring stays a single assignment in the composition root while
  // the deps stay captured here.
  const registerOutboxConsumers = () => {
    registerInboxConsumers({
      commandStore,
      reviewLookup: input.reviewLookup,
      reviewSourceLookup,
      inboxRepo,
      idGen: () => inboxItemId(crypto.randomUUID()),
      clock: input.clock,
    })
  }

  return {
    publicApi: {} as Record<string, never>,
    internal: {
      repos: {
        inboxRepo,
        inboxNoteRepo,
        inboxViewRepo,
        staffPublicApi: input.staffPublicApi,
      },
      commandStore,
      registerOutboxConsumers,
      useCases,
    },
  }
}
