// Inbox context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the inbox context.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { Redis } from 'ioredis'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { InboxRepository } from './application/ports/inbox.repository'
import type { InboxNoteRepository } from './application/ports/inbox-note.repository'
import type { NewCounterPort } from './application/ports/new-counter.port'
import type { ReviewLookupPort } from './application/ports/review-lookup.port'
import type { FeedbackLookupPort } from './application/ports/feedback-lookup.port'
import type { PropertyLookupPort } from './application/ports/property-lookup.port'
import type { createInboxItem as createInboxItemFn } from './application/use-cases/create-inbox-item'
import type { updateInboxStatus as updateInboxStatusFn } from './application/use-cases/update-inbox-status'
import type { bulkUpdateInboxStatus as bulkUpdateFn } from './application/use-cases/bulk-update-inbox-status'
import type { assignInboxItem as assignInboxItemFn } from './application/use-cases/assign-inbox-item'
import type { getInboxItems as getInboxItemsFn } from './application/use-cases/get-inbox-items'
import type { addInboxNote as addInboxNoteFn } from './application/use-cases/add-inbox-note'
import type { getNewCount as getNewCountFn } from './application/use-cases/get-new-count'
import type { getInboxItemDetail as getInboxItemDetailFn } from './application/use-cases/get-inbox-item-detail'
import type { getInboxNotes as getInboxNotesFn } from './application/use-cases/get-inbox-notes'
import type { getInboxFolderCounts as getInboxFolderCountsFn } from './application/use-cases/get-folder-counts'
import { createInboxRepository } from './infrastructure/repositories/inbox.repository'
import { createInboxNoteRepository } from './infrastructure/repositories/inbox-note.repository'
import { createRedisNewCounter } from './infrastructure/adapters/redis-new-counter'
import { registerInboxHandlers } from './infrastructure/event-handlers'
import { wireUseCases } from './build-use-cases'

export type InboxContextBuildInput = Readonly<{
  db: Database
  events: EventBus
  redis: Redis | undefined
  clock: () => Date
  staffPublicApi: StaffPublicApi
  reviewLookup: ReviewLookupPort
  feedbackLookup: FeedbackLookupPort
  propertyLookup: PropertyLookupPort
  logger: LoggerPort
}>

export type InboxContextApi = Readonly<{
  publicApi: Record<string, never>
  internal: Readonly<{
    repos: Readonly<{
      inboxRepo: InboxRepository
      inboxNoteRepo: InboxNoteRepository
      newCounter: NewCounterPort
      staffPublicApi: StaffPublicApi
    }>
    useCases: Readonly<{
      createInboxItem: ReturnType<typeof createInboxItemFn>
      updateInboxStatus: ReturnType<typeof updateInboxStatusFn>
      bulkUpdateInboxStatus: ReturnType<typeof bulkUpdateFn>
      assignInboxItem: ReturnType<typeof assignInboxItemFn>
      getInboxItems: ReturnType<typeof getInboxItemsFn>
      addInboxNote: ReturnType<typeof addInboxNoteFn>
      getNewCount: ReturnType<typeof getNewCountFn>
      getInboxItemDetail: ReturnType<typeof getInboxItemDetailFn>
      getInboxNotes: ReturnType<typeof getInboxNotesFn>
      getInboxFolderCounts: ReturnType<typeof getInboxFolderCountsFn>
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
  const newCounter: NewCounterPort = input.redis
    ? createRedisNewCounter(input.redis)
    : {
        getCount: async () => 0,
        setCount: async () => {},
        increment: async () => {},
        decrement: async () => {},
        decrementBy: async () => {},
        invalidate: async () => {},
      }

  const useCases = wireUseCases({
    inboxRepo,
    inboxNoteRepo,
    newCounter,
    events: input.events,
    staffPublicApi: input.staffPublicApi,
    logger: input.logger,
    clock: input.clock,
  })

  // Register cross-context event handlers
  registerInboxHandlers({
    events: input.events,
    createInboxItem: useCases.createInboxItem,
    repo: inboxRepo,
    newCounter,
  })

  return {
    publicApi: {} as Record<string, never>,
    internal: {
      repos: {
        inboxRepo,
        inboxNoteRepo,
        newCounter,
        staffPublicApi: input.staffPublicApi,
      },
      useCases,
    },
  }
}
