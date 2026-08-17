import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema/property.schema'
import { eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import { propertyOperationReceipts } from '#/shared/db/schema/property-operation-receipt.schema'
import type { EventBus } from '#/shared/events/event-bus'
import { emitAfterCommit, insertOutboxRow } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import { isValidIanaTimezone } from '#/shared/domain/timezones'
import {
  isGoogleBindingTupleValid,
  isGoogleResourceSuffix,
} from '../domain/google-binding-contract'
import {
  PROPERTY_OPERATION_RECEIPT_TTL_MS,
  PROPERTY_OPERATION_SWEEP_LIMIT,
  PropertyGoogleBindingError,
  type PropertyGoogleBindingInternalView,
  type PropertyGoogleBindingStore,
  type PropertyGoogleBindingSummary,
  type PropertyOperationCommit,
  type PropertyOperationOutcome,
  type PropertyOperationReceipt,
} from '../application/ports/property-google-binding.port'
import { propertyGoogleBindingChanged } from '../domain/events'
import { propertyToRow } from './mappers/property.mapper'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function deny(code: ConstructorParameters<typeof PropertyGoogleBindingError>[0]): never {
  throw new PropertyGoogleBindingError(code)
}

function validateIdempotencyKey(value: string): void {
  if (!UUID.test(value)) deny('invalid_binding')
}

function normalizeConfirmedProfile(profile: {
  name: string
  address: string | null
  timezone: string
  confirmedBy: string
}): {
  name: string
  address: string | null
  timezone: string
  confirmedBy: string
} {
  const name = profile.name.trim()
  const address = profile.address?.trim() || null
  const confirmedBy = profile.confirmedBy.trim()
  if (
    name.length < 1 ||
    name.length > 100 ||
    (address !== null && address.length > 500) ||
    !isValidIanaTimezone(profile.timezone) ||
    confirmedBy.length < 1 ||
    confirmedBy.length > 255
  ) {
    deny('invalid_binding')
  }
  return { name, address, timezone: profile.timezone, confirmedBy }
}

function summaryFromRow(
  row: typeof properties.$inferSelect,
): PropertyGoogleBindingSummary {
  return {
    state: row.googleBindingState as PropertyGoogleBindingSummary['state'],
    sourceEpoch: row.sourceEpoch,
    profileVersion: row.profileVersion,
    profileSource: row.profileSource as PropertyGoogleBindingSummary['profileSource'],
    profileConfirmedAt: row.profileConfirmedAt,
  }
}

function internalFromRow(
  row: typeof properties.$inferSelect,
): PropertyGoogleBindingInternalView {
  return {
    organizationId: organizationId(row.organizationId),
    propertyId: propertyId(row.id),
    state: row.googleBindingState as PropertyGoogleBindingInternalView['state'],
    connectionId: row.googleConnectionId
      ? googleConnectionId(row.googleConnectionId)
      : null,
    accountId: row.gbpAccountId,
    locationId: row.gbpLocationId,
    sourceEpoch: row.sourceEpoch,
    profileVersion: row.profileVersion,
    profileSource:
      row.profileSource as PropertyGoogleBindingInternalView['profileSource'],
    profileConfirmedAt: row.profileConfirmedAt,
    deletedAt: row.deletedAt,
    name: row.name,
    address: row.address,
    countryCode: row.countryCode,
    timezone: row.timezone,
    processingRegion: row.processingRegion,
    lifecycleState: row.lifecycleState,
  }
}

function receiptFromRow(
  row: typeof propertyOperationReceipts.$inferSelect,
): PropertyOperationReceipt {
  return {
    organizationId: organizationId(row.organizationId),
    idempotencyKey: row.idempotencyKey,
    destinationPropertyId: row.destinationPropertyId
      ? propertyId(row.destinationPropertyId)
      : null,
    outcome: row.outcome as PropertyOperationOutcome,
    destinationSourceEpoch: row.destinationSourceEpoch,
    destinationProfileVersion: row.destinationProfileVersion,
    tombstone: row.tombstone,
    expiresAt: row.expiresAt,
    retentionReleasedAt: row.retentionReleasedAt,
  }
}

function replayReceipt(
  receipt: PropertyOperationReceipt,
  expectedOutcome: Exclude<PropertyOperationOutcome, 'property_deleted'>,
  expectedPropertyId?: PropertyId,
): PropertyOperationCommit {
  if (receipt.tombstone && receipt.outcome === 'property_deleted') {
    return {
      propertyId: null,
      outcome: 'property_deleted',
      sourceEpoch: receipt.destinationSourceEpoch,
      profileVersion: receipt.destinationProfileVersion,
      replayed: true,
      tombstone: true,
    }
  }
  if (
    receipt.outcome !== expectedOutcome ||
    receipt.destinationPropertyId === null ||
    (expectedPropertyId !== undefined &&
      receipt.destinationPropertyId !== expectedPropertyId)
  ) {
    deny('idempotency_conflict')
  }
  return {
    propertyId: receipt.destinationPropertyId,
    outcome: receipt.outcome,
    sourceEpoch: receipt.destinationSourceEpoch,
    profileVersion: receipt.destinationProfileVersion,
    replayed: true,
    tombstone: false,
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { code?: unknown; cause?: unknown }
  return candidate.code === '23505' || isUniqueViolation(candidate.cause)
}

function assertBindingProfile(input: {
  state: 'unbound' | 'account_confirmation_required' | 'active' | 'disconnected'
  connectionId: ReturnType<typeof googleConnectionId> | null
  accountId: string | null
  locationId: string | null
  profileVersion: number
  profileSource: string
  profileConfirmedAt: Date | null
  profileConfirmedBy: string | null
}): void {
  if (
    !isGoogleBindingTupleValid(input) ||
    input.state !== 'active' ||
    input.profileSource !== 'tenant_confirmed' ||
    input.profileConfirmedAt === null ||
    input.profileConfirmedBy === null ||
    !Number.isSafeInteger(input.profileVersion) ||
    input.profileVersion < 1
  ) {
    deny('invalid_binding')
  }
}

export function createPropertyGoogleBindingStore(
  db: Database,
  events: EventBus,
): PropertyGoogleBindingStore {
  const readReceipt: PropertyGoogleBindingStore['readReceipt'] = async (
    organizationIdValue,
    idempotencyKey,
    now,
  ) => {
    validateIdempotencyKey(idempotencyKey)
    const [row] = await db
      .select()
      .from(propertyOperationReceipts)
      .where(
        and(
          eq(propertyOperationReceipts.organizationId, organizationIdValue),
          eq(propertyOperationReceipts.idempotencyKey, idempotencyKey),
          gt(propertyOperationReceipts.expiresAt, now),
        ),
      )
      .limit(1)
    return row ? receiptFromRow(row) : null
  }

  return Object.freeze({
    readInternal: async (organizationIdValue, propertyIdValue) => {
      const [row] = await db
        .select()
        .from(properties)
        .where(
          and(
            eq(properties.organizationId, organizationIdValue),
            eq(properties.id, propertyIdValue),
          ),
        )
        .limit(1)
      return row ? internalFromRow(row) : null
    },

    readByLocationIds: async (organizationIdValue, locationIds) => {
      if (
        locationIds.length < 1 ||
        locationIds.length > 100 ||
        new Set(locationIds).size !== locationIds.length ||
        locationIds.some((locationIdValue) => !isGoogleResourceSuffix(locationIdValue))
      ) {
        deny('invalid_binding')
      }
      const rows = await db
        .select()
        .from(properties)
        .where(
          and(
            eq(properties.organizationId, organizationIdValue),
            inArray(properties.gbpLocationId, locationIds),
            isNull(properties.deletedAt),
          ),
        )
        .limit(100)
      return rows.map(internalFromRow)
    },

    readSummary: async (organizationIdValue, propertyIdValue) => {
      const [row] = await db
        .select()
        .from(properties)
        .where(
          and(
            eq(properties.organizationId, organizationIdValue),
            eq(properties.id, propertyIdValue),
          ),
        )
        .limit(1)
      return row ? summaryFromRow(row) : null
    },

    readReceipt,

    createBoundProperty: async (input) => {
      validateIdempotencyKey(input.idempotencyKey)
      const existingReceipt = await readReceipt(
        input.organizationId,
        input.idempotencyKey,
        input.now,
      )
      if (existingReceipt) return replayReceipt(existingReceipt, 'imported')
      if (
        input.property.organizationId !== input.organizationId ||
        input.property.deletedAt !== null
      ) {
        deny('invalid_binding')
      }
      assertBindingProfile({
        state: input.property.googleBindingState,
        connectionId: input.property.googleConnectionId,
        accountId: input.property.gbpAccountId,
        locationId: input.property.gbpLocationId,
        profileVersion: input.property.profileVersion,
        profileSource: input.property.profileSource,
        profileConfirmedAt: input.property.profileConfirmedAt,
        profileConfirmedBy: input.property.profileConfirmedBy,
      })
      const connectionIdValue = input.property.googleConnectionId
      if (!connectionIdValue) deny('invalid_binding')
      const event = propertyGoogleBindingChanged({
        organizationId: input.organizationId,
        propertyId: input.property.id,
        connectionId: connectionIdValue,
        sourceEpoch: input.property.sourceEpoch,
        change: 'created',
        occurredAt: input.now,
      })

      try {
        const result = await trace('property.googleBinding.create', () =>
          db.transaction(async (tx) => {
            const [racedReceipt] = await tx
              .select()
              .from(propertyOperationReceipts)
              .where(
                and(
                  eq(propertyOperationReceipts.organizationId, input.organizationId),
                  eq(propertyOperationReceipts.idempotencyKey, input.idempotencyKey),
                  gt(propertyOperationReceipts.expiresAt, input.now),
                ),
              )
              .limit(1)
            if (racedReceipt)
              return replayReceipt(receiptFromRow(racedReceipt), 'imported')

            await tx.insert(properties).values(propertyToRow(input.property))
            await tx.insert(propertyOperationReceipts).values({
              organizationId: input.organizationId,
              idempotencyKey: input.idempotencyKey,
              destinationPropertyId: input.property.id,
              outcome: 'imported',
              destinationSourceEpoch: input.property.sourceEpoch,
              destinationProfileVersion: input.property.profileVersion,
              tombstone: false,
              expiresAt: new Date(
                input.now.getTime() + PROPERTY_OPERATION_RECEIPT_TTL_MS,
              ),
              createdAt: input.now,
              updatedAt: input.now,
            })
            await insertOutboxRow(tx, event)
            return {
              propertyId: input.property.id,
              outcome: 'imported',
              sourceEpoch: input.property.sourceEpoch,
              profileVersion: input.property.profileVersion,
              replayed: false,
              tombstone: false,
            } satisfies PropertyOperationCommit
          }),
        )
        if (!result.replayed) await emitAfterCommit(events, event)
        return result
      } catch (error) {
        if (!isUniqueViolation(error)) throw error
        const racedReceipt = await readReceipt(
          input.organizationId,
          input.idempotencyKey,
          input.now,
        )
        if (racedReceipt) return replayReceipt(racedReceipt, 'imported')
        deny('location_already_bound')
      }
    },

    relink: async (input) => {
      validateIdempotencyKey(input.idempotencyKey)
      const profile = normalizeConfirmedProfile(input.profile)
      if (
        !isGoogleResourceSuffix(input.accountId) ||
        !isGoogleResourceSuffix(input.locationId)
      ) {
        deny('invalid_binding')
      }
      const existingReceipt = await readReceipt(
        input.organizationId,
        input.idempotencyKey,
        input.now,
      )
      if (existingReceipt) {
        return replayReceipt(existingReceipt, 'relinked', input.propertyId)
      }
      let event: ReturnType<typeof propertyGoogleBindingChanged> | undefined
      try {
        const result = await trace('property.googleBinding.relink', () =>
          db.transaction(async (tx) => {
            const [racedReceipt] = await tx
              .select()
              .from(propertyOperationReceipts)
              .where(
                and(
                  eq(propertyOperationReceipts.organizationId, input.organizationId),
                  eq(propertyOperationReceipts.idempotencyKey, input.idempotencyKey),
                  gt(propertyOperationReceipts.expiresAt, input.now),
                ),
              )
              .limit(1)
            if (racedReceipt) {
              return replayReceipt(
                receiptFromRow(racedReceipt),
                'relinked',
                input.propertyId,
              )
            }
            const [current] = await tx
              .select()
              .from(properties)
              .where(
                and(
                  eq(properties.organizationId, input.organizationId),
                  eq(properties.id, input.propertyId),
                ),
              )
              .for('update')
              .limit(1)
            if (!current) deny('property_not_found')
            if (current.deletedAt !== null) deny('property_deleted')
            if (current.sourceEpoch !== input.expectedSourceEpoch) deny('stale_binding')
            if (current.profileVersion !== input.expectedProfileVersion)
              deny('stale_profile')
            if (current.googleBindingState === 'active') deny('active_binding_conflict')

            const nextSourceEpoch = current.sourceEpoch + 1
            const nextProfileVersion = current.profileVersion + 1
            const [updated] = await tx
              .update(properties)
              .set({
                googleConnectionId: input.connectionId,
                gbpAccountId: input.accountId,
                gbpLocationId: input.locationId,
                googleBindingState: 'active',
                sourceEpoch: nextSourceEpoch,
                name: profile.name,
                address: profile.address,
                timezone: profile.timezone,
                timezoneSource: 'tenant_confirmed',
                timezoneResolvedAt: input.now,
                profileVersion: nextProfileVersion,
                profileSource: 'tenant_confirmed',
                profileConfirmedAt: input.now,
                profileConfirmedBy: profile.confirmedBy,
                updatedAt: input.now,
              })
              .where(
                and(
                  eq(properties.organizationId, input.organizationId),
                  eq(properties.id, input.propertyId),
                  eq(properties.sourceEpoch, input.expectedSourceEpoch),
                  eq(properties.profileVersion, input.expectedProfileVersion),
                ),
              )
              .returning({ id: properties.id })
            if (!updated) deny('stale_binding')
            await tx.insert(propertyOperationReceipts).values({
              organizationId: input.organizationId,
              idempotencyKey: input.idempotencyKey,
              destinationPropertyId: input.propertyId,
              outcome: 'relinked',
              destinationSourceEpoch: nextSourceEpoch,
              destinationProfileVersion: nextProfileVersion,
              tombstone: false,
              expiresAt: new Date(
                input.now.getTime() + PROPERTY_OPERATION_RECEIPT_TTL_MS,
              ),
              createdAt: input.now,
              updatedAt: input.now,
            })
            event = propertyGoogleBindingChanged({
              organizationId: input.organizationId,
              propertyId: input.propertyId,
              connectionId: input.connectionId,
              sourceEpoch: nextSourceEpoch,
              change: 'relinked',
              occurredAt: input.now,
            })
            await insertOutboxRow(tx, event)
            return {
              propertyId: input.propertyId,
              outcome: 'relinked',
              sourceEpoch: nextSourceEpoch,
              profileVersion: nextProfileVersion,
              replayed: false,
              tombstone: false,
            } satisfies PropertyOperationCommit
          }),
        )
        if (!result.replayed && event) await emitAfterCommit(events, event)
        return result
      } catch (error) {
        if (!isUniqueViolation(error)) throw error
        const racedReceipt = await readReceipt(
          input.organizationId,
          input.idempotencyKey,
          input.now,
        )
        if (racedReceipt) {
          return replayReceipt(racedReceipt, 'relinked', input.propertyId)
        }
        deny('location_already_bound')
      }
    },

    disconnect: async (input) => {
      let event: ReturnType<typeof propertyGoogleBindingChanged> | undefined
      const result = await trace('property.googleBinding.disconnect', () =>
        db.transaction(async (tx) => {
          const [current] = await tx
            .select()
            .from(properties)
            .where(
              and(
                eq(properties.organizationId, input.organizationId),
                eq(properties.id, input.propertyId),
              ),
            )
            .for('update')
            .limit(1)
          if (!current) deny('property_not_found')
          if (current.deletedAt !== null) deny('property_deleted')
          if (current.googleBindingState === 'disconnected')
            return summaryFromRow(current)
          if (current.sourceEpoch !== input.expectedSourceEpoch) deny('stale_binding')
          if (current.profileVersion !== input.expectedProfileVersion)
            deny('stale_profile')
          if (current.googleBindingState !== 'active' || !current.googleConnectionId) {
            deny('active_binding_conflict')
          }
          const nextSourceEpoch = current.sourceEpoch + 1
          const [updated] = await tx
            .update(properties)
            .set({
              googleBindingState: 'disconnected',
              sourceEpoch: nextSourceEpoch,
              updatedAt: input.now,
            })
            .where(
              and(
                eq(properties.organizationId, input.organizationId),
                eq(properties.id, input.propertyId),
                eq(properties.sourceEpoch, input.expectedSourceEpoch),
                eq(properties.profileVersion, input.expectedProfileVersion),
              ),
            )
            .returning()
          if (!updated) deny('stale_binding')
          event = propertyGoogleBindingChanged({
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            connectionId: googleConnectionId(current.googleConnectionId),
            sourceEpoch: nextSourceEpoch,
            change: 'disconnected',
            occurredAt: input.now,
          })
          await insertOutboxRow(tx, event)
          return summaryFromRow(updated)
        }),
      )
      if (event) await emitAfterCommit(events, event)
      return result
    },

    scrubProviderIdentity: async (input) => {
      let event: ReturnType<typeof propertyGoogleBindingChanged> | undefined
      const result = await trace('property.googleBinding.scrub', () =>
        db.transaction(async (tx) => {
          const [current] = await tx
            .select()
            .from(properties)
            .where(
              and(
                eq(properties.organizationId, input.organizationId),
                eq(properties.id, input.propertyId),
              ),
            )
            .for('update')
            .limit(1)
          if (!current) deny('property_not_found')
          if (current.deletedAt !== null) deny('property_deleted')
          if (
            current.googleBindingState === 'unbound' &&
            current.googleConnectionId === null &&
            current.gbpAccountId === null &&
            current.gbpLocationId === null
          ) {
            return summaryFromRow(current)
          }
          if (current.sourceEpoch !== input.expectedSourceEpoch) deny('stale_binding')
          if (current.profileVersion !== input.expectedProfileVersion)
            deny('stale_profile')
          if (!current.googleConnectionId) deny('invalid_binding')
          const nextSourceEpoch = current.sourceEpoch + 1
          const [updated] = await tx
            .update(properties)
            .set({
              googleConnectionId: null,
              gbpAccountId: null,
              gbpLocationId: null,
              googleBindingState: 'unbound',
              sourceEpoch: nextSourceEpoch,
              updatedAt: input.now,
            })
            .where(
              and(
                eq(properties.organizationId, input.organizationId),
                eq(properties.id, input.propertyId),
                eq(properties.sourceEpoch, input.expectedSourceEpoch),
                eq(properties.profileVersion, input.expectedProfileVersion),
              ),
            )
            .returning()
          if (!updated) deny('stale_binding')
          event = propertyGoogleBindingChanged({
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            connectionId: googleConnectionId(current.googleConnectionId),
            sourceEpoch: nextSourceEpoch,
            change: 'deletion_started',
            occurredAt: input.now,
          })
          await insertOutboxRow(tx, event)
          return summaryFromRow(updated)
        }),
      )
      if (event) await emitAfterCommit(events, event)
      return result
    },

    releaseRetention: async (input) => {
      const uniqueKeys = [...new Set(input.idempotencyKeys)]
      if (
        uniqueKeys.length === 0 ||
        uniqueKeys.length > PROPERTY_OPERATION_SWEEP_LIMIT ||
        uniqueKeys.some((key) => !UUID.test(key))
      ) {
        deny('invalid_binding')
      }
      const rows = await db
        .update(propertyOperationReceipts)
        .set({ retentionReleasedAt: input.releasedAt, updatedAt: input.releasedAt })
        .where(
          and(
            eq(propertyOperationReceipts.organizationId, input.organizationId),
            inArray(propertyOperationReceipts.idempotencyKey, uniqueKeys),
            sql`${propertyOperationReceipts.retentionReleasedAt} IS NULL`,
          ),
        )
        .returning({ id: propertyOperationReceipts.id })
      return rows.length
    },

    sweepReleasedExpired: async (input) => {
      if (
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > PROPERTY_OPERATION_SWEEP_LIMIT
      ) {
        deny('sweep_limit_invalid')
      }
      return db.transaction(async (tx) => {
        const rows = await tx
          .select({ id: propertyOperationReceipts.id })
          .from(propertyOperationReceipts)
          .where(
            and(
              isNotNull(propertyOperationReceipts.retentionReleasedAt),
              lte(propertyOperationReceipts.expiresAt, input.now),
            ),
          )
          .orderBy(
            asc(propertyOperationReceipts.expiresAt),
            asc(propertyOperationReceipts.id),
          )
          .for('update', { skipLocked: true })
          .limit(input.limit)
        if (rows.length === 0) return 0
        const deleted = await tx
          .delete(propertyOperationReceipts)
          .where(
            inArray(
              propertyOperationReceipts.id,
              rows.map((row) => row.id),
            ),
          )
          .returning({ id: propertyOperationReceipts.id })
        return deleted.length
      })
    },

    countUnreleasedExpired: async (input) => {
      if (
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > PROPERTY_OPERATION_SWEEP_LIMIT
      ) {
        deny('sweep_limit_invalid')
      }
      const rows = await db
        .select({ id: propertyOperationReceipts.id })
        .from(propertyOperationReceipts)
        .where(
          and(
            isNull(propertyOperationReceipts.retentionReleasedAt),
            lte(propertyOperationReceipts.expiresAt, input.now),
          ),
        )
        .orderBy(
          asc(propertyOperationReceipts.expiresAt),
          asc(propertyOperationReceipts.id),
        )
        .limit(input.limit)
      return rows.length
    },

    releaseRetentionFromEvent: async (input) => {
      const uniqueKeys = [...new Set(input.idempotencyKeys)]
      if (
        !UUID.test(input.eventId) ||
        uniqueKeys.length === 0 ||
        uniqueKeys.length > PROPERTY_OPERATION_SWEEP_LIMIT ||
        uniqueKeys.some((key) => !UUID.test(key))
      ) {
        deny('invalid_binding')
      }
      return db.transaction(async (tx) => {
        const [insertedReceipt] = await tx
          .insert(eventConsumerReceipts)
          .values({
            eventId: input.eventId,
            consumerName: 'property.import-retention-release',
            status: 'applied',
            createdAt: input.releasedAt,
          })
          .onConflictDoNothing()
          .returning({ eventId: eventConsumerReceipts.eventId })
        if (!insertedReceipt) return 'duplicate'
        await tx
          .update(propertyOperationReceipts)
          .set({
            retentionReleasedAt: input.releasedAt,
            updatedAt: input.releasedAt,
          })
          .where(
            and(
              eq(propertyOperationReceipts.organizationId, input.organizationId),
              inArray(propertyOperationReceipts.idempotencyKey, uniqueKeys),
              sql`${propertyOperationReceipts.retentionReleasedAt} IS NULL`,
            ),
          )
        return 'applied'
      })
    },

    cleanupOrganization: async (organizationIdValue: OrganizationId) => {
      const rows = await db
        .delete(propertyOperationReceipts)
        .where(eq(propertyOperationReceipts.organizationId, organizationIdValue))
        .returning({ id: propertyOperationReceipts.id })
      return rows.length
    },
  })
}
