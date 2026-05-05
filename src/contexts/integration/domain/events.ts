// Integration context — domain events
// Per architecture: "Events are facts, named in the past tense."

import type { GoogleConnectionId, GbpImportJobId, OrganizationId } from '#/shared/domain/ids'

export type GoogleAccountConnected = Readonly<{
  _tag: 'google_account.connected'
  connectionId: GoogleConnectionId
  organizationId: OrganizationId
  googleEmail: string
  occurredAt: Date
}>

export type GoogleAccountDisconnected = Readonly<{
  _tag: 'google_account.disconnected'
  connectionId: GoogleConnectionId
  organizationId: OrganizationId
  occurredAt: Date
}>

export type PropertyImportCompleted = Readonly<{
  _tag: 'property_import.completed'
  importJobId: GbpImportJobId
  organizationId: OrganizationId
  totalCount: number
  importedCount: number
  skippedCount: number
  failedCount: number
  occurredAt: Date
}>

export type IntegrationEvent =
  | GoogleAccountConnected
  | GoogleAccountDisconnected
  | PropertyImportCompleted

export const googleAccountConnected = (
  args: Omit<GoogleAccountConnected, '_tag'>,
): GoogleAccountConnected => ({ _tag: 'google_account.connected', ...args })

export const googleAccountDisconnected = (
  args: Omit<GoogleAccountDisconnected, '_tag'>,
): GoogleAccountDisconnected => ({ _tag: 'google_account.disconnected', ...args })

export const propertyImportCompleted = (
  args: Omit<PropertyImportCompleted, '_tag'>,
): PropertyImportCompleted => ({ _tag: 'property_import.completed', ...args })
