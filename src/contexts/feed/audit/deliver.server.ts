import type { Database } from '#/shared/db'
import { eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import type { AuditEvent } from './event.server'
import { writeAuditEvent } from './write.server'

export type AuditDeliveryStore = Readonly<{
  /** Writes the audit event and the consumer receipt in one transaction. */
  applyOnce: (
    input: Readonly<{ event: AuditEvent; eventId: string; consumerName: string }>,
  ) => Promise<'applied' | 'duplicate'>
}>

export const createAuditDeliveryStore = (db: Database): AuditDeliveryStore => ({
  applyOnce: ({ event, eventId, consumerName }) =>
    db.transaction(async (transaction) => {
      const written = await writeAuditEvent(transaction, event)
      const status = written.status === 'appended' ? 'applied' : 'duplicate'
      await transaction
        .insert(eventConsumerReceipts)
        .values({ eventId, consumerName, status })
        .onConflictDoNothing()
      return status
    }),
})
