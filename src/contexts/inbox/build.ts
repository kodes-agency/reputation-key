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
import type { UnreadCounterPort } from './application/ports/unread-counter.port'
import { createInboxRepository } from './infrastructure/repositories/inbox.repository'
import { createInboxNoteRepository } from './infrastructure/repositories/inbox-note.repository'
import { createRedisUnreadCounter } from './infrastructure/adapters/redis-unread-counter'
import { createInboxItem as createInboxItemUseCase } from './application/use-cases/create-inbox-item'
import { updateInboxStatus } from './application/use-cases/update-inbox-status'
import { bulkUpdateInboxStatus } from './application/use-cases/bulk-update-inbox-status'
import { assignInboxItem } from './application/use-cases/assign-inbox-item'
import { getInboxItems } from './application/use-cases/get-inbox-items'
import { addInboxNote } from './application/use-cases/add-inbox-note'
import { getUnreadCount } from './application/use-cases/get-unread-count'
import { getInboxItemDetail } from './application/use-cases/get-inbox-item-detail'
import { getInboxNotes } from './application/use-cases/get-inbox-notes'
import { registerInboxHandlers } from './infrastructure/event-handlers'
import { inboxItemId, inboxNoteId } from '#/shared/domain/ids'

export type InboxContextBuildInput = Readonly<{
  db: Database
  events: EventBus
  redis: Redis | undefined
  clock: () => Date
  staffPublicApi: StaffPublicApi
  logger: LoggerPort
}>

export type InboxContextApi = Readonly<{
  useCases: Readonly<{
    createInboxItem: ReturnType<typeof createInboxItemUseCase>
    updateInboxStatus: ReturnType<typeof updateInboxStatus>
    bulkUpdateInboxStatus: ReturnType<typeof bulkUpdateInboxStatus>
    assignInboxItem: ReturnType<typeof assignInboxItem>
    getInboxItems: ReturnType<typeof getInboxItems>
    addInboxNote: ReturnType<typeof addInboxNote>
    getUnreadCount: ReturnType<typeof getUnreadCount>
    getInboxItemDetail: ReturnType<typeof getInboxItemDetail>
    getInboxNotes: ReturnType<typeof getInboxNotes>
  }>
  inboxRepo: InboxRepository
  inboxNoteRepo: InboxNoteRepository
  unreadCounter: UnreadCounterPort
  staffPublicApi: StaffPublicApi
}>

export const buildInboxContext = (input: InboxContextBuildInput): InboxContextApi => {
  const inboxRepo = createInboxRepository(input.db)
  const inboxNoteRepo = createInboxNoteRepository(input.db)
  const unreadCounter: UnreadCounterPort = input.redis
    ? createRedisUnreadCounter(input.redis)
    : {
        getCount: async () => 0,
        setCount: async () => {},
        increment: async () => {},
        decrement: async () => {},
        invalidate: async () => {},
      }

  const useCases = {
    createInboxItem: createInboxItemUseCase({
      repo: inboxRepo,
      events: input.events,
      unreadCounter,
      idGen: () => inboxItemId(crypto.randomUUID()),
      clock: input.clock,
      logger: input.logger,
    }),
    updateInboxStatus: updateInboxStatus({
      repo: inboxRepo,
      events: input.events,
      unreadCounter,
      clock: input.clock,
      staffPublicApi: input.staffPublicApi,
      logger: input.logger,
    }),
    bulkUpdateInboxStatus: bulkUpdateInboxStatus({
      repo: inboxRepo,
      events: input.events,
      unreadCounter,
      clock: input.clock,
      staffPublicApi: input.staffPublicApi,
      logger: input.logger,
    }),
    assignInboxItem: assignInboxItem({
      repo: inboxRepo,
      events: input.events,
      clock: input.clock,
      staffPublicApi: input.staffPublicApi,
    }),
    getInboxItems: getInboxItems({
      repo: inboxRepo,
      staffPublicApi: input.staffPublicApi,
    }),
    addInboxNote: addInboxNote({
      repo: inboxRepo,
      noteRepo: inboxNoteRepo,
      idGen: () => inboxNoteId(crypto.randomUUID()),
      clock: input.clock,
      staffPublicApi: input.staffPublicApi,
    }),
    getUnreadCount: getUnreadCount({
      unreadCounter,
      repo: inboxRepo,
      logger: input.logger,
    }),
    getInboxItemDetail: getInboxItemDetail({
      repo: inboxRepo,
      staffPublicApi: input.staffPublicApi,
    }),
    getInboxNotes: getInboxNotes({
      noteRepo: inboxNoteRepo,
      repo: inboxRepo,
      staffPublicApi: input.staffPublicApi,
    }),
  }

  // Register cross-context event handlers
  registerInboxHandlers({
    events: input.events,
    createInboxItem: useCases.createInboxItem,
    repo: inboxRepo,
  })

  return {
    useCases,
    inboxRepo,
    inboxNoteRepo,
    unreadCounter,
    staffPublicApi: input.staffPublicApi,
  }
}
