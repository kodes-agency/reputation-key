// Inbox context — use-case wiring (extracted from build.ts for line-count compliance)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."

import type { InboxRepository } from './application/ports/inbox.repository'
import type { InboxNoteRepository } from './application/ports/inbox-note.repository'
import type { InboxViewRepository } from './application/ports/inbox-view.repository'
import type { InboxCommandStore } from './application/ports/inbox-command-store.port'
import type { ReviewSourceLookupPort } from './application/ports/review-source-lookup.port'
import type { ReplyLookupPort } from './application/ports/reply-lookup.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { InboxContextApi } from './build'
import { createInboxItem as createInboxItemUseCase } from './application/use-cases/create-inbox-item'
import { updateInboxStatus } from './application/use-cases/update-inbox-status'
import { bulkUpdateInboxStatus } from './application/use-cases/bulk-update-inbox-status'
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
import { rebuildInboxProjection } from './application/use-cases/rebuild-inbox-projection'
import { inboxItemId, inboxNoteId } from '#/shared/domain/ids'

type WireInput = Readonly<{
  inboxRepo: InboxRepository
  inboxNoteRepo: InboxNoteRepository
  inboxViewRepo: InboxViewRepository
  commandStore: InboxCommandStore
  reviewSourceLookup: ReviewSourceLookupPort
  replyLookup: ReplyLookupPort
  staffPublicApi: StaffPublicApi
  logger: LoggerPort
  clock: () => Date
}>

export function wireUseCases(input: WireInput): InboxContextApi['internal']['useCases'] {
  return {
    createInboxItem: createInboxItemUseCase({
      repo: input.inboxRepo,
      commandStore: input.commandStore,
      idGen: () => inboxItemId(crypto.randomUUID()),
      clock: input.clock,
    }),
    updateInboxStatus: updateInboxStatus({
      repo: input.inboxRepo,
      commandStore: input.commandStore,
      clock: input.clock,
      staffPublicApi: input.staffPublicApi,
    }),
    bulkUpdateInboxStatus: bulkUpdateInboxStatus({
      repo: input.inboxRepo,
      commandStore: input.commandStore,
      clock: input.clock,
      staffPublicApi: input.staffPublicApi,
      logger: input.logger,
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
    }),
    addInboxNote: addInboxNote({
      repo: input.inboxRepo,
      commandStore: input.commandStore,
      idGen: () => inboxNoteId(crypto.randomUUID()),
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
    }),
    getInboxNotes: getInboxNotes({
      noteRepo: input.inboxNoteRepo,
      repo: input.inboxRepo,
      staffPublicApi: input.staffPublicApi,
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
      idGen: () => inboxItemId(crypto.randomUUID()),
      clock: input.clock,
      logger: input.logger,
    }),
  }
}
