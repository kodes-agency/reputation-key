// Atomic property command store (BQC-3.5).
//
// One PostgreSQL transaction per command: properties state mutation +
// outbox_events insert. After commit: in-process EventBus emit for
// expand-phase legacy consumers.
//
// Crash contract:
// - Crash anywhere inside the transaction rolls back BOTH the state mutation
//   and the outbox row — no state/outbox split is ever observable (the
//   pre-BQC-3.5 use cases could lose the fact between the repo write and
//   the separate fact record, and the integration property-event adapter
//   never recorded at all).
// - Crash after commit but before the bus emit leaves a durable outbox row
//   for the relay; the emit is best-effort (failure-isolated, logged).

import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { properties } from '#/shared/db/schema/property.schema'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { getLogger } from '#/shared/observability/logger'
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

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

async function emitAfterCommit(events: EventBus, event: DomainEvent): Promise<void> {
  // Expand-phase dual path: durable outbox already committed. Bus failure must
  // not roll back or hide the durable fact (relay will deliver when enabled).
  try {
    await events.emit(event)
  } catch (err) {
    getLogger().warn(
      { err, eventType: event._tag, eventId: event.eventId },
      'BQC-3.5: in-process emit failed after atomic outbox commit — durable row retained',
    )
  }
}

async function insertOutboxRow(tx: Tx, event: DomainEvent): Promise<void> {
  await tx.insert(outboxEvents).values({ ...toOutboxEvent(event), id: event.eventId })
}

/** Mutable set-values type for Drizzle .set() — mirrors PropertyRepository.update. */
type PropertySetValues = {
  name?: string
  slug?: string
  timezone?: string
  gbpPlaceId?: string | null
  updatedAt?: Date
  deletedAt?: Date | null
  countryCode?: string | null
  countrySource?: string | null
  timezoneSource?: string | null
  timezoneResolvedAt?: Date | null
  processingRegion?: string | null
  processingRegionSource?: string | null
  routingPolicyVersion?: number
  processingRegionResolvedAt?: Date | null
  sourceEpoch?: number
}

/** Same field-picking as PropertyRepository.update — never sets identity columns. */
function buildPropertySetClause(patch: Readonly<Partial<Property>>): PropertySetValues {
  const set: PropertySetValues = {}
  if (patch.updatedAt !== undefined) set.updatedAt = patch.updatedAt
  if (patch.name !== undefined) set.name = patch.name
  if (patch.slug !== undefined) set.slug = patch.slug
  if (patch.timezone !== undefined) set.timezone = patch.timezone
  if (patch.gbpPlaceId !== undefined) set.gbpPlaceId = patch.gbpPlaceId
  if (patch.countryCode !== undefined) set.countryCode = patch.countryCode
  if (patch.countrySource !== undefined) set.countrySource = patch.countrySource
  if (patch.timezoneSource !== undefined) set.timezoneSource = patch.timezoneSource
  if (patch.timezoneResolvedAt !== undefined)
    set.timezoneResolvedAt = patch.timezoneResolvedAt
  if (patch.processingRegion !== undefined) set.processingRegion = patch.processingRegion
  if (patch.processingRegionSource !== undefined)
    set.processingRegionSource = patch.processingRegionSource
  if (patch.routingPolicyVersion !== undefined)
    set.routingPolicyVersion = patch.routingPolicyVersion
  if (patch.processingRegionResolvedAt !== undefined)
    set.processingRegionResolvedAt = patch.processingRegionResolvedAt
  if (patch.sourceEpoch !== undefined) set.sourceEpoch = patch.sourceEpoch
  return set
}

export function createAtomicPropertyCommandStore(
  db: Database,
  events: EventBus,
): PropertyCommandStore {
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
        await emitAfterCommit(events, command.event)
        return propertyFromRow(inserted)
      })
    },

    updateProperty: async (command: UpdatePropertyCommand) => {
      return trace('property.commandStore.updateProperty', async () => {
        await db.transaction(async (tx) => {
          await tx
            .update(properties)
            .set(buildPropertySetClause(command.patch))
            .where(
              and(
                eq(properties.organizationId, command.organizationId as string),
                eq(properties.id, command.propertyId as string),
                isNull(properties.deletedAt),
              ),
            )
          await insertOutboxRow(tx, command.event)
        })
        await emitAfterCommit(events, command.event)
      })
    },

    deleteProperty: async (command: DeletePropertyCommand) => {
      return trace('property.commandStore.deleteProperty', async () => {
        await db.transaction(async (tx) => {
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
        })
        await emitAfterCommit(events, command.event)
      })
    },
  }
}
