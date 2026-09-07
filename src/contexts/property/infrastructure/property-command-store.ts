// Atomic property command store (BQC-3.5).
//
// One PostgreSQL transaction commits each property state mutation with its
// outbox_events row. A fact exists exactly when that durable row commits.
//
// Crash contract:
// - Crash anywhere inside the transaction rolls back BOTH the state mutation
//   and the outbox row — no state/outbox split is ever observable (the
//   pre-BQC-3.5 use cases could lose the fact between the repo write and
//   the separate fact record, and the integration property-event adapter
//   never recorded at all).
// - A successful commit makes the durable fact available to the outbox relay.

import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema/property.schema'
import { idempotencyReceipts } from '#/shared/db/schema/outbox.schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import { propertyError } from '../domain/errors'
import type { Property } from '../domain/types'
import { propertyFromRow, propertyToRow } from './mappers/property.mapper'
import type {
  CreatePropertyCommand,
  DeletePropertyCommand,
  PropertyCommandStore,
  UpdatePropertyCommand,
} from '../application/ports/property-command-store.port'
import type { PropertySetValues } from './repositories/property.repository'

/** The columns a property patch may set — never identity columns. */
const SETTABLE_PROPERTY_KEYS = [
  'updatedAt',
  'name',
  'slug',
  'timezone',
  'defaultReplyLanguage',
  'address',
  'gbpLocationId',
  'gbpAccountId',
  'googleConnectionId',
  'profileVersion',
  'googleBindingState',
  'profileSource',
  'profileConfirmedAt',
  'profileConfirmedBy',
  'countryCode',
  'countrySource',
  'timezoneSource',
  'timezoneResolvedAt',
  'sourceEpoch',
] as const satisfies ReadonlyArray<keyof PropertySetValues & keyof Property>

/** Same field-picking as PropertyRepository.update — never sets identity columns. */
function buildPropertySetClause(patch: Readonly<Partial<Property>>): PropertySetValues {
  const set: Record<string, unknown> = {}
  for (const key of SETTABLE_PROPERTY_KEYS) {
    if (patch[key] !== undefined) set[key] = patch[key]
  }
  return set as PropertySetValues
}

export const createAtomicPropertyCommandStore = (db: Database): PropertyCommandStore => {
  return {
    createProperty: async (command: CreatePropertyCommand) => {
      return trace('property.commandStore.createProperty', async () => {
        const inserted = await db.transaction(async (tx) => {
          // Tenant guard — last line of defense against cross-tenant writes
          // (same contract as PropertyRepository.insert/insertAndReturn).
          if (command.property.organizationId !== command.organizationId) {
            throw propertyError('forbidden', 'Tenant mismatch on property insert')
          }
          const rows = await tx
            .insert(properties)
            .values(propertyToRow(command.property))
            .returning()
          if (!rows[0]) {
            throw propertyError(
              'property_not_found',
              'Failed to retrieve inserted property',
            )
          }
          await insertOutboxRow(tx, command.event)
          return rows[0]
        })
        return propertyFromRow(inserted)
      })
    },

    updateProperty: async (command: UpdatePropertyCommand) => {
      return trace('property.commandStore.updateProperty', async () => {
        await db.transaction(async (tx) => {
          const [updated] = await tx
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
            .returning({ id: properties.id })
          if (!updated) {
            throw propertyError(
              'stale_property',
              'property changed while the update was being committed',
            )
          }
          await insertOutboxRow(tx, command.event)
        })
      })
    },

    deleteProperty: async (command: DeletePropertyCommand) => {
      return trace('property.commandStore.deleteProperty', async () => {
        await db.transaction(async (tx) => {
          const [current] = await tx
            .select({
              sourceEpoch: properties.sourceEpoch,
              profileVersion: properties.profileVersion,
              googleConnectionId: properties.googleConnectionId,
            })
            .from(properties)
            .where(
              and(
                eq(properties.organizationId, command.organizationId as string),
                eq(properties.id, command.propertyId as string),
                isNull(properties.deletedAt),
              ),
            )
            .for('update')
            .limit(1)
          if (
            !current ||
            current.sourceEpoch !== command.expectedSourceEpoch ||
            current.profileVersion !== command.expectedProfileVersion ||
            (command.bindingEvent &&
              current.googleConnectionId !== command.bindingEvent.connectionId)
          ) {
            throw propertyError(
              'stale_property',
              'property changed while the deletion was being committed',
            )
          }
          await tx
            .update(idempotencyReceipts)
            .set({
              payload: sql`${idempotencyReceipts.payload} || jsonb_build_object(
                'destinationPropertyId', NULL,
                'outcome', 'property_deleted',
                'tombstone', true,
                'destinationSourceEpoch', ${current.sourceEpoch + 1}::integer,
                'destinationProfileVersion', ${current.profileVersion}::integer
              )`,
            })
            .where(
              and(
                eq(idempotencyReceipts.scope, 'property_operation'),
                sql`${idempotencyReceipts.payload}->>'organizationId' = ${command.organizationId as string}`,
                sql`${idempotencyReceipts.payload}->>'destinationPropertyId' = ${command.propertyId as string}`,
              ),
            )
          await tx
            .delete(properties)
            .where(
              and(
                eq(properties.organizationId, command.organizationId as string),
                eq(properties.id, command.propertyId as string),
                isNull(properties.deletedAt),
              ),
            )
          await insertOutboxRow(tx, command.event)
          if (command.bindingEvent) {
            await insertOutboxRow(tx, command.bindingEvent)
          }
        })
      })
    },
  }
}
