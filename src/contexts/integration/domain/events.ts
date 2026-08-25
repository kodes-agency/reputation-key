// Integration context — domain events
// Standards: docs/standards.md §1

import { newEventId } from '#/shared/domain/event-id'
import { assert } from '#/shared/domain/assert'
import type { GoogleConnectionId, OrganizationId, UserId } from '#/shared/domain/ids'

export type IntegrationPropertyImportRequested = Readonly<{
  _tag: 'integration.property_import.requested'
  eventId: string
  organizationId: OrganizationId
  importJobId: string
  occurredAt: Date
  correlationId: string | null
}>

export const integrationPropertyImportRequested = (
  args: Omit<IntegrationPropertyImportRequested, '_tag' | 'correlationId' | 'eventId'>,
): IntegrationPropertyImportRequested => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'integration.property_import.requested',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export type IntegrationGoogleAccountConnected = Readonly<{
  _tag: 'integration.google_account.connected'
  eventId: string
  connectionId: GoogleConnectionId
  organizationId: OrganizationId
  connectedBy: UserId
  occurredAt: Date
  correlationId: string | null
}>
export const integrationGoogleAccountConnected = (
  args: Omit<IntegrationGoogleAccountConnected, '_tag' | 'correlationId' | 'eventId'>,
): IntegrationGoogleAccountConnected => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'integration.google_account.connected',
    eventId: newEventId(),
    correlationId: null,
    ...args,
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
  args: Omit<IntegrationGoogleAccountDisconnected, '_tag' | 'correlationId' | 'eventId'>,
): IntegrationGoogleAccountDisconnected => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'integration.google_account.disconnected',
    eventId: newEventId(),
    correlationId: null,
    ...args,
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
  args: Omit<
    IntegrationGoogleConnectionVisibilityChanged,
    '_tag' | 'correlationId' | 'eventId'
  >,
): IntegrationGoogleConnectionVisibilityChanged => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'integration.google_connection.visibility_changed',
    eventId: newEventId(),
    correlationId: null,
    ...args,
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
  args: Omit<
    IntegrationPropertyImportRetentionReleased,
    '_tag' | 'correlationId' | 'eventId'
  >,
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
    correlationId: null,
    ...args,
  }
}

export type IntegrationEvent =
  | IntegrationGoogleAccountConnected
  | IntegrationGoogleAccountDisconnected
  | IntegrationGoogleConnectionVisibilityChanged
  | IntegrationPropertyImportRetentionReleased
  | IntegrationPropertyImportRequested
