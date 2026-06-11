// Property context — domain events
// Standards: docs/standards.md §1

import type { PropertyId } from './types'
import type { OrganizationId, GoogleConnectionId } from '#/shared/domain/ids'
import { propertyError } from './errors'

export type PropertyCreated = Readonly<{
  _tag: 'property.created'
  eventId: string
  propertyId: PropertyId
  organizationId: OrganizationId
  name: string
  slug: string
  // F063 NOTE: gbpPlaceId and gbpLocationName are optional because
  // properties can be created without GBP integration. When populated
  // via importProperty, googleConnectionId is set but gbpLocationName
  // is still empty — it must be filled in by a subsequent GBP sync.
  gbpPlaceId?: string
  gbpLocationName?: string
  googleConnectionId?: GoogleConnectionId
  occurredAt: Date
  correlationId: string | null
}>
export const propertyCreated = (
  args: Omit<PropertyCreated, '_tag' | 'correlationId'>,
): PropertyCreated => {
  if (!(args.occurredAt instanceof Date))
    throw propertyError('invalid_name', 'occurredAt must be Date')
  return {
    _tag: 'property.created',
    correlationId: null,
    ...args,
  }
}

export type PropertyUpdated = Readonly<{
  _tag: 'property.updated'
  eventId: string
  propertyId: PropertyId
  organizationId: OrganizationId
  name: string
  slug: string
  occurredAt: Date
  correlationId: string | null
}>
export const propertyUpdated = (
  args: Omit<PropertyUpdated, '_tag' | 'correlationId'>,
): PropertyUpdated => {
  if (!(args.occurredAt instanceof Date))
    throw propertyError('invalid_name', 'occurredAt must be Date')
  return {
    _tag: 'property.updated',
    correlationId: null,
    ...args,
  }
}

export type PropertyDeleted = Readonly<{
  _tag: 'property.deleted'
  eventId: string
  propertyId: PropertyId
  organizationId: OrganizationId
  occurredAt: Date
  correlationId: string | null
}>
export const propertyDeleted = (
  args: Omit<PropertyDeleted, '_tag' | 'correlationId'>,
): PropertyDeleted => {
  if (!(args.occurredAt instanceof Date))
    throw propertyError('invalid_name', 'occurredAt must be Date')
  return {
    _tag: 'property.deleted',
    correlationId: null,
    ...args,
  }
}

export type PropertyEvent = PropertyCreated | PropertyUpdated | PropertyDeleted
