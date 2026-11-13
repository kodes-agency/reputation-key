import { inboxNotes } from '#/shared/db/schema/inbox.schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import { inboxError } from '#/contexts/inbox/domain/errors'
import { inTransaction } from '#/contexts/inbox/infrastructure/inbox-command-transaction'
import {
  inboxNoteFromRow,
  inboxNoteToInsertRow,
} from '#/contexts/inbox/infrastructure/mappers/inbox-note.mapper'
import type { InboxCommandStore } from '#/contexts/inbox/application/ports/inbox-command-store.port'
import { updateItemRow } from '#/contexts/inbox/infrastructure/inbox-source-projection'
import type { CommandRuntime } from './command-runtime.server'

export const createNoteCommands = (
  runtime: CommandRuntime,
): Pick<InboxCommandStore, 'addNote'> => {
  const { db, assertCommandAuthority, authorityRequirements, actorPrincipals } = runtime

  return {
    addNote: async (item, note, event, lent) => {
      return trace('inbox.commandStore.addNote', async () => {
        return inTransaction(db, lent, async (tx) => {
          await assertCommandAuthority(
            tx,
            item.organizationId,
            note.createdAt,
            authorityRequirements(item, actorPrincipals(item, event)),
          )
          await updateItemRow(
            tx,
            item,
            { updatedAt: note.createdAt },
            'Inbox item note update failed — no row returned',
          )
          const result = await tx
            .insert(inboxNotes)
            .values(inboxNoteToInsertRow(note))
            .returning()
          if (!result[0]) {
            throw inboxError('not_found', 'Inbox note insert failed — no row returned')
          }
          await insertOutboxRow(tx, event)
          return inboxNoteFromRow(result[0])
        })
      })
    },
  }
}
