// Inbox context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the inbox context.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { InboxRepository } from './application/ports/inbox.repository'
import type { InboxNoteRepository } from './application/ports/inbox-note.repository'
import type { InboxViewRepository } from './application/ports/inbox-view.repository'
import type { InboxCommandStore } from './application/ports/inbox-command-store.port'
import type { ReviewLookupPort } from './application/ports/review-lookup.port'
import type { ReviewSourceLookupPort } from './application/ports/review-source-lookup.port'
import type { FeedbackLookupPort } from './application/ports/feedback-lookup.port'
import type { PropertyLookupPort } from './application/ports/property-lookup.port'
import type { ReplyLookupPort } from './application/ports/reply-lookup.port'
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
import { wireUseCases } from './build-use-cases'

export type InboxContextBuildInput = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
  staffPublicApi: StaffPublicApi
  reviewLookup: ReviewLookupPort
  reviewSourceLookup: ReviewSourceLookupPort
  feedbackLookup: FeedbackLookupPort
  propertyLookup: PropertyLookupPort
  replyLookup: ReplyLookupPort
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
  const inboxRepo = createInboxRepository(input.db, {
    reviewLookup: input.reviewLookup,
    feedbackLookup: input.feedbackLookup,
    propertyLookup: input.propertyLookup,
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
    reviewSourceLookup: input.reviewSourceLookup,
    replyLookup: input.replyLookup,
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
      useCases,
    },
  }
}
