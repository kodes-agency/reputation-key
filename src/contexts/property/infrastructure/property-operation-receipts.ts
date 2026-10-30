// Property context — the receipt a Google binding command leaves so that a retry
// of the same command returns the same answer. It holds identifiers, an outcome
// and the two counters the command produced, never a profile field. It lived in
// the binding store until that file reached its file-length ceiling; nothing about
// it changed in the move.

import { organizationId, propertyId, type PropertyId } from '#/shared/domain/ids'
import {
  PropertyGoogleBindingError,
  type PropertyOperationCommit,
  type PropertyOperationOutcome,
  type PropertyOperationReceipt,
} from '../application/ports/property-google-binding.port'

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
