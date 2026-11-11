// Property operation receipts preserve command outcomes and recover their
// downstream obligations without storing profile content.

import {
  googleConnectionId,
  organizationId,
  propertyId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema/property.schema'
import { idempotencyReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { propertyGoogleBindingChanged } from '../domain/events'
import {
  PROPERTY_OPERATION_RECEIPT_TTL_MS,
  PropertyGoogleBindingError,
  type PropertyOperationCommit,
  type PropertyOperationOutcome,
  type PropertyOperationReceipt,
  type PropertyGoogleBindingStore,
} from '../application/ports/property-google-binding.port'

/** The caller holds the import item lock and commits its terminal checkpoint
 * in this transaction. A fresh fact survives receipts on an unmarked event. */
export const ensureImportFollowUps: PropertyGoogleBindingStore['ensureImportFollowUps'] =
  async (tx, receipt, now) => {
    if (
      receipt.tombstone ||
      receipt.destinationPropertyId === null ||
      (receipt.outcome !== 'imported' && receipt.outcome !== 'relinked')
    )
      return
    const [binding] = await tx
      .select()
      .from(properties)
      .where(
        and(
          eq(properties.organizationId, receipt.organizationId),
          eq(properties.id, receipt.destinationPropertyId),
        ),
      )
      .limit(1)
    if (
      !binding ||
      binding.deletedAt !== null ||
      binding.lifecycleState !== 'active' ||
      binding.googleBindingState !== 'active' ||
      binding.sourceEpoch !== receipt.destinationSourceEpoch ||
      binding.googleConnectionId === null
    )
      return
    const [marked] = await tx
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.organizationId, receipt.organizationId),
          eq(outboxEvents.propertyId, receipt.destinationPropertyId),
          eq(outboxEvents.eventType, 'property.google_binding.changed'),
          sql`${outboxEvents.payload}->>'sourceEpoch' = ${String(receipt.destinationSourceEpoch)}`,
          sql`${outboxEvents.payload}->>'importFollowUps' = 'true'`,
        ),
      )
      .limit(1)
    if (marked) return
    await insertOutboxRow(
      tx,
      propertyGoogleBindingChanged({
        organizationId: receipt.organizationId,
        propertyId: receipt.destinationPropertyId,
        connectionId: googleConnectionId(binding.googleConnectionId),
        sourceEpoch: receipt.destinationSourceEpoch,
        change: receipt.outcome === 'imported' ? 'created' : 'relinked',
        importFollowUps: true,
        occurredAt: now,
      }),
    )
  }

type PropertyOperationReceiptPayload = Readonly<{
  organizationId: string
  idempotencyKey: string
  destinationPropertyId: string | null
  outcome: PropertyOperationOutcome
  destinationSourceEpoch: number
  destinationProfileVersion: number
  tombstone: boolean
  expiresAt: string
  retentionReleasedAt: string | null
}>

export const propertyReceiptKey = (
  organizationIdValue: string,
  idempotencyKey: string,
): string => JSON.stringify([organizationIdValue, idempotencyKey])

export const propertyReceiptPayload = (
  receipt: PropertyOperationReceipt,
): PropertyOperationReceiptPayload => ({
  organizationId: receipt.organizationId,
  idempotencyKey: receipt.idempotencyKey,
  destinationPropertyId: receipt.destinationPropertyId,
  outcome: receipt.outcome,
  destinationSourceEpoch: receipt.destinationSourceEpoch,
  destinationProfileVersion: receipt.destinationProfileVersion,
  tombstone: receipt.tombstone,
  expiresAt: receipt.expiresAt.toISOString(),
  retentionReleasedAt: receipt.retentionReleasedAt?.toISOString() ?? null,
})

export function receiptFromRow(row: {
  payload: Readonly<Record<string, unknown>>
}): PropertyOperationReceipt {
  const payload = row.payload
  const expiresAt =
    typeof payload.expiresAt === 'string'
      ? new Date(payload.expiresAt)
      : new Date(Number.NaN)
  const retentionReleasedAt =
    typeof payload.retentionReleasedAt === 'string'
      ? new Date(payload.retentionReleasedAt)
      : null
  if (
    typeof payload.organizationId !== 'string' ||
    typeof payload.idempotencyKey !== 'string' ||
    (payload.destinationPropertyId !== null &&
      typeof payload.destinationPropertyId !== 'string') ||
    (payload.outcome !== 'imported' &&
      payload.outcome !== 'relinked' &&
      payload.outcome !== 'property_deleted') ||
    typeof payload.destinationSourceEpoch !== 'number' ||
    !Number.isSafeInteger(payload.destinationSourceEpoch) ||
    typeof payload.destinationProfileVersion !== 'number' ||
    !Number.isSafeInteger(payload.destinationProfileVersion) ||
    typeof payload.tombstone !== 'boolean' ||
    Number.isNaN(expiresAt.getTime()) ||
    (retentionReleasedAt !== null && Number.isNaN(retentionReleasedAt.getTime()))
  ) {
    throw new Error('property operation receipt payload is invalid')
  }
  return {
    organizationId: organizationId(payload.organizationId),
    idempotencyKey: payload.idempotencyKey,
    destinationPropertyId: payload.destinationPropertyId
      ? propertyId(payload.destinationPropertyId)
      : null,
    outcome: payload.outcome,
    destinationSourceEpoch: payload.destinationSourceEpoch,
    destinationProfileVersion: payload.destinationProfileVersion,
    tombstone: payload.tombstone,
    expiresAt,
    retentionReleasedAt,
  }
}

export function replayReceipt(
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
    throw new PropertyGoogleBindingError('idempotency_conflict')
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

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

export const RETENTION_UNRELEASED = sql`${idempotencyReceipts.payload}->'retentionReleasedAt' = 'null'::jsonb`

/** Drops the key's expired receipt, then returns one a racing writer committed. */
export const findLiveReceipt = async (tx: Tx, receiptKey: string, now: Date) => {
  await tx
    .delete(idempotencyReceipts)
    .where(
      and(
        eq(idempotencyReceipts.scope, 'property_operation'),
        eq(idempotencyReceipts.key, receiptKey),
        sql`(${idempotencyReceipts.payload}->>'expiresAt')::timestamptz <= ${now}`,
      ),
    )
  const [racedReceipt] = await tx
    .select({ payload: idempotencyReceipts.payload })
    .from(idempotencyReceipts)
    .where(
      and(
        eq(idempotencyReceipts.scope, 'property_operation'),
        eq(idempotencyReceipts.key, receiptKey),
      ),
    )
    .limit(1)
  return racedReceipt
}

export const recordReceipt = async (
  tx: Tx,
  input: {
    organizationId: OrganizationId
    idempotencyKey: string
    destinationPropertyId: PropertyId
    outcome: 'imported' | 'relinked'
    sourceEpoch: number
    profileVersion: number
    now: Date
  },
) => {
  await tx.insert(idempotencyReceipts).values({
    scope: 'property_operation',
    key: propertyReceiptKey(input.organizationId, input.idempotencyKey),
    payload: propertyReceiptPayload({
      organizationId: input.organizationId,
      idempotencyKey: input.idempotencyKey,
      destinationPropertyId: input.destinationPropertyId,
      outcome: input.outcome,
      destinationSourceEpoch: input.sourceEpoch,
      destinationProfileVersion: input.profileVersion,
      tombstone: false,
      expiresAt: new Date(input.now.getTime() + PROPERTY_OPERATION_RECEIPT_TTL_MS),
      retentionReleasedAt: null,
    }),
    recordedAt: input.now,
  })
}

export const markRetentionReleased = (
  executor: Pick<Database, 'update'>,
  organizationIdValue: OrganizationId,
  idempotencyKeys: ReadonlyArray<string>,
  releasedAt: Date,
) =>
  executor
    .update(idempotencyReceipts)
    .set({
      payload: sql`${idempotencyReceipts.payload} || jsonb_build_object(
        'retentionReleasedAt', ${releasedAt.toISOString()}::timestamptz
      )`,
    })
    .where(
      and(
        eq(idempotencyReceipts.scope, 'property_operation'),
        inArray(
          idempotencyReceipts.key,
          idempotencyKeys.map((key) => propertyReceiptKey(organizationIdValue, key)),
        ),
        RETENTION_UNRELEASED,
      ),
    )
    .returning({ key: idempotencyReceipts.key })
