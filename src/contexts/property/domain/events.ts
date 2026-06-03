// Property context — domain events
// Standards: docs/standards.md §1

import type { PropertyId } from './types'
import type { OrganizationId, GoogleConnectionId } from '#/shared/domain/ids'

export type PropertyCreated = Readonly<{
  _tag: 'property.created'
  eventId: string
  propertyId: PropertyId
  organizationId: OrganizationId
  name: string
  slug: string
  gbpPlaceId?: string
  gbpLocationName?: string
  googleConnectionId?: GoogleConnectionId
  occurredAt: Date
  correlationId: string | null
}>
export const propertyCreated = (
  args: Omit<PropertyCreated, '_tag' | 'eventId' | 'correlationId'>,
): PropertyCreated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'property.created',
    eventId: crypto.randomUUID(),
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
  args: Omit<PropertyUpdated, '_tag' | 'eventId' | 'correlationId'>,
): PropertyUpdated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'property.updated',
    eventId: crypto.randomUUID(),
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
  args: Omit<PropertyDeleted, '_tag' | 'eventId' | 'correlationId'>,
): PropertyDeleted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'property.deleted',
    eventId: crypto.randomUUID(),
    correlationId: null,
    ...args,
  }
}

export type PropertyEvent = PropertyCreated | PropertyUpdated | PropertyDeleted
