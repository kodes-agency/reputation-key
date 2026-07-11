// Property context — domain events
// Standards: docs/standards.md §1

import type { PropertyId } from './types'
import type { OrganizationId, GoogleConnectionId } from '#/shared/domain/ids'
import { newEventId } from '#/shared/domain/event-id'
import { assert } from '#/shared/domain/assert'

export type PropertyCreated = Readonly<{
  _tag: 'property.created'
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
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
  args: Omit<PropertyCreated, '_tag' | 'eventId' | 'correlationId'>,
): PropertyCreated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'property.created',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export type PropertyUpdated = Readonly<{
  _tag: 'property.updated'
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
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
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export type PropertyDeleted = Readonly<{
  _tag: 'property.deleted'
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  occurredAt: Date
  correlationId: string | null
}>
export const propertyDeleted = (
  args: Omit<PropertyDeleted, '_tag' | 'eventId' | 'correlationId'>,
): PropertyDeleted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'property.deleted',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export type PropertyEvent = PropertyCreated | PropertyUpdated | PropertyDeleted
