import type { Database } from '#/shared/db'
import { guestResponses } from '#/shared/db/schema/guest.schema'
import type { EventBus } from '#/shared/events/event-bus'
import { emitAfterCommit, insertOutboxRow } from '#/shared/outbox/commit'
import type { GuestResponseCommandStore } from '../application/ports/guest-response-command-store.port'
import { guestResponseToInsertRow } from './mappers/guest-response.mapper'
import { trace } from '#/shared/observability/trace'

/** Atomic canonical response + rating/feedback fact writer. */
export function createAtomicGuestResponseCommandStore(
  db: Database,
  events: EventBus,
): GuestResponseCommandStore {
  return {
    commitSubmitted: (response, facts) =>
      trace('guest.commandStore.commitSubmitted', async () => {
        const outcome = await db.transaction(async (tx) => {
          const inserted = await tx
            .insert(guestResponses)
            .values(guestResponseToInsertRow(response))
            .onConflictDoNothing()
            .returning({ id: guestResponses.id })
          if (inserted.length === 0) return 'duplicate' as const
          for (const fact of facts) await insertOutboxRow(tx, fact)
          return 'applied' as const
        })
        if (outcome === 'applied') {
          for (const fact of facts) await emitAfterCommit(events, fact)
        }
        return outcome
      }),
  }
}
