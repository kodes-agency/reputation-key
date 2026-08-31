// Integration context — domain events
// Standards: docs/standards.md §1

import { newEventId } from '#/shared/domain/event-id'
import { assert } from '#/shared/domain/assert'
import type { GoogleConnectionId, OrganizationId, UserId } from '#/shared/domain/ids'

type IntegrationEventArgs<T> = Omit<T, '_tag' | 'eventId' | 'correlationId'> &
  Readonly<{ correlationId?: string | null }>

export type IntegrationPropertyImportRequested = Readonly<{
  _tag: 'integration.property_import.requested'
  eventId: string
  organizationId: OrganizationId
  importJobId: string
  occurredAt: Date
  correlationId: string | null
}>

export const integrationPropertyImportRequested = (
  args: IntegrationEventArgs<IntegrationPropertyImportRequested>,
): IntegrationPropertyImportRequested => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'integration.property_import.requested',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export type IntegrationGoogleAccountConnected = Readonly<{
  _tag: 'integration.google_account.connected'
  eventId: string
  connectionId: GoogleConnectionId
  organizationId: OrganizationId
  userId: UserId
  occurredAt: Date
  correlationId: string | null
}>
export const integrationGoogleAccountConnected = (
  args: IntegrationEventArgs<IntegrationGoogleAccountConnected>,
): IntegrationGoogleAccountConnected => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'integration.google_account.connected',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export type IntegrationGoogleAccountDisconnected = Readonly<{
  _tag: 'integration.google_account.disconnected'
  eventId: string
  connectionId: GoogleConnectionId
  organizationId: OrganizationId
  occurredAt: Date
  correlationId: string | null
}>
export const integrationGoogleAccountDisconnected = (
  args: IntegrationEventArgs<IntegrationGoogleAccountDisconnected>,
): IntegrationGoogleAccountDisconnected => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'integration.google_account.disconnected',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export type IntegrationGoogleAccountReauthorizationRequired = Readonly<{
  _tag: 'integration.google_account.reauthorization_required'
  eventId: string
  connectionId: GoogleConnectionId
  organizationId: OrganizationId
  cause: 'member_removed' | 'account_admin_role_lost'
  occurredAt: Date
  correlationId: string | null
}>

export const integrationGoogleAccountReauthorizationRequired = (
  args: IntegrationEventArgs<IntegrationGoogleAccountReauthorizationRequired>,
): IntegrationGoogleAccountReauthorizationRequired => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'integration.google_account.reauthorization_required',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export type IntegrationGoogleConnectionVisibilityChanged = Readonly<{
  _tag: 'integration.google_connection.visibility_changed'
  eventId: string
  connectionId: GoogleConnectionId
  organizationId: OrganizationId
  visibility: 'private' | 'organization'
  occurredAt: Date
  correlationId: string | null
}>
export const integrationGoogleConnectionVisibilityChanged = (
  args: IntegrationEventArgs<IntegrationGoogleConnectionVisibilityChanged>,
): IntegrationGoogleConnectionVisibilityChanged => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'integration.google_connection.visibility_changed',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export type IntegrationPropertyImportRetentionReleased = Readonly<{
  _tag: 'integration.property_import.retention_released'
  eventId: string
  organizationId: OrganizationId
  importJobId: string
  idempotencyKeys: readonly string[]
  occurredAt: Date
  correlationId: string | null
}>

export const integrationPropertyImportRetentionReleased = (
  args: IntegrationEventArgs<IntegrationPropertyImportRetentionReleased>,
): IntegrationPropertyImportRetentionReleased => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.importJobId !== '', 'importJobId required')
  assert(
    args.idempotencyKeys.length >= 1 &&
      args.idempotencyKeys.length <= 100 &&
      new Set(args.idempotencyKeys).size === args.idempotencyKeys.length,
    'idempotencyKeys must contain 1..100 unique values',
  )
  return {
    _tag: 'integration.property_import.retention_released',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export type GoogleReviewPushNotificationKind =
  'NEW_REVIEW' | 'UPDATED_REVIEW' | 'REVIEW_CHANGED'

/**
 * Durable, identifier-only handoff from authenticated GBP push ingress.
 * The provider review resource remains behind `referenceRef` in the
 * provider-ephemeral store and is never copied into this event.
 */
export type IntegrationGoogleReviewPushAccepted = Readonly<{
  _tag: 'integration.google_review_push.accepted'
  eventId: string
  organizationId: OrganizationId
  propertyId: string
  connectionId: GoogleConnectionId
  sourceEpoch: number
  referenceRef: string | null
  notificationKind: GoogleReviewPushNotificationKind
  occurredAt: Date
  correlationId: string | null
}>

export const integrationGoogleReviewPushAccepted = (
  args: IntegrationEventArgs<IntegrationGoogleReviewPushAccepted>,
): IntegrationGoogleReviewPushAccepted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.propertyId !== '', 'propertyId required')
  assert(Number.isSafeInteger(args.sourceEpoch) && args.sourceEpoch >= 0, 'sourceEpoch')
  return {
    _tag: 'integration.google_review_push.accepted',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export type IntegrationEvent =
  | IntegrationGoogleAccountConnected
  | IntegrationGoogleAccountDisconnected
  | IntegrationGoogleAccountReauthorizationRequired
  | IntegrationGoogleConnectionVisibilityChanged
  | IntegrationGoogleReviewPushAccepted
  | IntegrationPropertyImportRetentionReleased
  | IntegrationPropertyImportRequested
