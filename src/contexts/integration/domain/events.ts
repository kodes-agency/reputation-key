// Integration context — domain events
// Standards: docs/standards.md §1

import { newEventId } from '#/shared/domain/event-id'
import type {
  GoogleConnectionId,
  GbpImportJobId,
  OrganizationId,
} from '#/shared/domain/ids'
import { integrationError } from './errors'

export type IntegrationGoogleAccountConnected = Readonly<{
  _tag: 'integration.google_account.connected'
  eventId: string
  connectionId: GoogleConnectionId
  organizationId: OrganizationId
  googleEmail: string
  occurredAt: Date
  correlationId: string | null
}>
export const integrationGoogleAccountConnected = (
  args: Omit<IntegrationGoogleAccountConnected, '_tag' | 'correlationId' | 'eventId'>,
): IntegrationGoogleAccountConnected => {
  if (!(args.occurredAt instanceof Date))
    throw integrationError('invalid_event', 'occurredAt must be Date')
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
  if (!(args.occurredAt instanceof Date))
    throw integrationError('invalid_event', 'occurredAt must be Date')
  return {
    _tag: 'integration.google_account.disconnected',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export type IntegrationPropertyImportCompleted = Readonly<{
  _tag: 'integration.property_import.completed'
  eventId: string
  importJobId: GbpImportJobId
  organizationId: OrganizationId
  totalCount: number
  importedCount: number
  skippedCount: number
  failedCount: number
  occurredAt: Date
  correlationId: string | null
}>
export const integrationPropertyImportCompleted = (
  args: Omit<IntegrationPropertyImportCompleted, '_tag' | 'correlationId' | 'eventId'>,
): IntegrationPropertyImportCompleted => {
  if (!(args.occurredAt instanceof Date))
    throw integrationError('invalid_event', 'occurredAt must be Date')
  return {
    _tag: 'integration.property_import.completed',
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
  if (!(args.occurredAt instanceof Date))
    throw integrationError('invalid_event', 'occurredAt must be Date')
  return {
    _tag: 'integration.google_connection.visibility_changed',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export type IntegrationEvent =
  | IntegrationGoogleAccountConnected
  | IntegrationGoogleAccountDisconnected
  | IntegrationGoogleConnectionVisibilityChanged
  | IntegrationPropertyImportCompleted
