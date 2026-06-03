// Inbox context — use-case wiring (extracted from build.ts for line-count compliance)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."

import type { InboxRepository } from './application/ports/inbox.repository'
import type { InboxNoteRepository } from './application/ports/inbox-note.repository'
import type { NewCounterPort } from './application/ports/new-counter.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { InboxContextApi } from './build'
import { createInboxItem as createInboxItemUseCase } from './application/use-cases/create-inbox-item'
import { updateInboxStatus } from './application/use-cases/update-inbox-status'
import { bulkUpdateInboxStatus } from './application/use-cases/bulk-update-inbox-status'
import { assignInboxItem } from './application/use-cases/assign-inbox-item'
import { getInboxItems } from './application/use-cases/get-inbox-items'
import { addInboxNote } from './application/use-cases/add-inbox-note'
import { getNewCount } from './application/use-cases/get-new-count'
import { getInboxItemDetail } from './application/use-cases/get-inbox-item-detail'
import { getInboxFolderCounts } from './application/use-cases/get-folder-counts'
import { getInboxNotes } from './application/use-cases/get-inbox-notes'
import { inboxItemId, inboxNoteId } from '#/shared/domain/ids'

type WireInput = Readonly<{
  inboxRepo: InboxRepository
  inboxNoteRepo: InboxNoteRepository
  newCounter: NewCounterPort
  events: EventBus
  staffPublicApi: StaffPublicApi
  logger: LoggerPort
  clock: () => Date
}>

export function wireUseCases(input: WireInput): InboxContextApi['internal']['useCases'] {
  return {
    createInboxItem: createInboxItemUseCase({
      repo: input.inboxRepo,
      events: input.events,
      newCounter: input.newCounter,
      idGen: () => inboxItemId(crypto.randomUUID()),
      clock: input.clock,
      logger: input.logger,
    }),
    updateInboxStatus: updateInboxStatus({
      repo: input.inboxRepo,
      events: input.events,
      newCounter: input.newCounter,
      clock: input.clock,
      staffPublicApi: input.staffPublicApi,
      logger: input.logger,
    }),
    bulkUpdateInboxStatus: bulkUpdateInboxStatus({
      repo: input.inboxRepo,
      events: input.events,
      newCounter: input.newCounter,
      clock: input.clock,
      staffPublicApi: input.staffPublicApi,
      logger: input.logger,
    }),
    assignInboxItem: assignInboxItem({
      repo: input.inboxRepo,
      events: input.events,
      clock: input.clock,
      staffPublicApi: input.staffPublicApi,
    }),
    getInboxItems: getInboxItems({
      repo: input.inboxRepo,
      staffPublicApi: input.staffPublicApi,
    }),
    addInboxNote: addInboxNote({
      repo: input.inboxRepo,
      noteRepo: input.inboxNoteRepo,
      events: input.events,
      idGen: () => inboxNoteId(crypto.randomUUID()),
      clock: input.clock,
      staffPublicApi: input.staffPublicApi,
    }),
    getNewCount: getNewCount({
      newCounter: input.newCounter,
      repo: input.inboxRepo,
      logger: input.logger,
    }),
    getInboxItemDetail: getInboxItemDetail({
      repo: input.inboxRepo,
      staffPublicApi: input.staffPublicApi,
    }),
    getInboxNotes: getInboxNotes({
      noteRepo: input.inboxNoteRepo,
      repo: input.inboxRepo,
      staffPublicApi: input.staffPublicApi,
    }),
    getInboxFolderCounts: getInboxFolderCounts({
      repo: input.inboxRepo,
    }),
  }
}
