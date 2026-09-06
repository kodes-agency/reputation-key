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

import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema/property.schema'
import { propertyOperationReceipts } from '#/shared/db/schema/property-operation-receipt.schema'
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
import type { DataCellId } from '#/shared/domain/data-cell-catalogue'

/** Same field-picking as PropertyRepository.update — never sets identity columns. */
function buildPropertySetClause(patch: Readonly<Partial<Property>>): PropertySetValues {
  const set: PropertySetValues = {}
  if (patch.updatedAt !== undefined) set.updatedAt = patch.updatedAt
  if (patch.name !== undefined) set.name = patch.name
  if (patch.slug !== undefined) set.slug = patch.slug
  if (patch.timezone !== undefined) set.timezone = patch.timezone
  if (patch.defaultReplyLanguage !== undefined)
    set.defaultReplyLanguage = patch.defaultReplyLanguage
  if (patch.address !== undefined) set.address = patch.address
  if (patch.gbpLocationId !== undefined) set.gbpLocationId = patch.gbpLocationId
  if (patch.gbpAccountId !== undefined) set.gbpAccountId = patch.gbpAccountId
  if (patch.googleConnectionId !== undefined)
    set.googleConnectionId = patch.googleConnectionId
  if (patch.profileVersion !== undefined) set.profileVersion = patch.profileVersion
  if (patch.googleBindingState !== undefined)
    set.googleBindingState = patch.googleBindingState
  if (patch.profileSource !== undefined) set.profileSource = patch.profileSource
  if (patch.profileConfirmedAt !== undefined)
    set.profileConfirmedAt = patch.profileConfirmedAt
  if (patch.profileConfirmedBy !== undefined)
    set.profileConfirmedBy = patch.profileConfirmedBy
  if (patch.countryCode !== undefined) set.countryCode = patch.countryCode
  if (patch.countrySource !== undefined) set.countrySource = patch.countrySource
  if (patch.timezoneSource !== undefined) set.timezoneSource = patch.timezoneSource
  if (patch.timezoneResolvedAt !== undefined)
    set.timezoneResolvedAt = patch.timezoneResolvedAt
  if (patch.processingRegion !== undefined) set.processingRegion = patch.processingRegion
  if (patch.dataCellId !== undefined) set.dataCellId = patch.dataCellId
  if (patch.processingRegionSource !== undefined)
    set.processingRegionSource = patch.processingRegionSource
  if (patch.routingPolicyVersion !== undefined)
    set.routingPolicyVersion = patch.routingPolicyVersion
  if (patch.processingRegionResolvedAt !== undefined)
    set.processingRegionResolvedAt = patch.processingRegionResolvedAt
  if (patch.sourceEpoch !== undefined) set.sourceEpoch = patch.sourceEpoch
  return set
}

export const createAtomicPropertyCommandStore = (
  db: Database,
  localCell?: DataCellId,
): PropertyCommandStore => {
  return {
    createProperty: async (command: CreatePropertyCommand) => {
      return trace('property.commandStore.createProperty', async () => {
        const inserted = await db.transaction(async (tx) => {
          // Tenant guard — last line of defense against cross-tenant writes
          // (same contract as PropertyRepository.insert/insertAndReturn).
          if (command.property.organizationId !== command.organizationId) {
            throw propertyError('forbidden', 'Tenant mismatch on property insert')
          }
          if (localCell && command.property.dataCellId !== localCell) {
            throw propertyError(
              'forbidden',
              'Property Data Cell does not match command store',
            )
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
                ...(localCell ? [eq(properties.dataCellId, localCell)] : []),
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
                ...(localCell ? [eq(properties.dataCellId, localCell)] : []),
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
            .update(propertyOperationReceipts)
            .set({
              destinationPropertyId: null,
              outcome: 'property_deleted',
              tombstone: true,
              destinationSourceEpoch: current.sourceEpoch + 1,
              destinationProfileVersion: current.profileVersion,
              updatedAt: command.event.occurredAt,
            })
            .where(
              and(
                eq(
                  propertyOperationReceipts.organizationId,
                  command.organizationId as string,
                ),
                eq(
                  propertyOperationReceipts.destinationPropertyId,
                  command.propertyId as string,
                ),
              ),
            )
          await tx
            .delete(properties)
            .where(
              and(
                eq(properties.organizationId, command.organizationId as string),
                eq(properties.id, command.propertyId as string),
                ...(localCell ? [eq(properties.dataCellId, localCell)] : []),
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
