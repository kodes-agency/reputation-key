// Commits a Property profile update and its outbox fact in one transaction: a
// crash rolls back both, so the fact exists exactly when the update committed.

import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema/property.schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import { propertyError } from '../domain/errors'
import {
  buildPropertySetClause,
  propertyFromRow,
} from '../infrastructure/mappers/property.mapper'
import type {
  PropertyCommandStore,
  UpdatePropertyCommand,
} from '../application/ports/property-command-store.port'

export const createAtomicPropertyCommandStore = (db: Database): PropertyCommandStore => {
  return {
    updateProperty: async (command: UpdatePropertyCommand) => {
      return trace('property.commandStore.updateProperty', async () => {
        const updated = await db.transaction(async (tx) => {
          const [row] = await tx
            .update(properties)
            .set(buildPropertySetClause(command.patch))
            .where(
              and(
                eq(properties.organizationId, command.organizationId as string),
                eq(properties.id, command.propertyId as string),
                isNull(properties.deletedAt),
                eq(properties.sourceEpoch, command.expectedSourceEpoch),
                eq(properties.profileVersion, command.expectedProfileVersion),
              ),
            )
            .returning()
          if (!row) {
            throw propertyError(
              'stale_property',
              'property changed while the update was being committed',
            )
          }
          // The fact names the row this statement left, not the caller's read.
          const committed = propertyFromRow(row)
          await insertOutboxRow(tx, command.event(committed))
          return committed
        })
        return updated
      })
    },
  }
}
