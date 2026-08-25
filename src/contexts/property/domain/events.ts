// Property context — domain events
// Standards: docs/standards.md §1

import type { PropertyId } from './types'
import type { OrganizationId, GoogleConnectionId } from '#/shared/domain/ids'
import { newEventId } from '#/shared/domain/event-id'
import { assert } from '#/shared/domain/assert'
import type { DataCellId } from '#/shared/domain/data-cell-catalogue'

export type PropertyCreated = Readonly<{
  _tag: 'property.created'
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  slug: string
  /**
   * BQC-4.1 / ADR 0048: content-free routing fact at creation time. The
   * initial-sync consumer enqueues only when this names an approved cell.
   */
  processingRegion?: string
  /** Canonical immutable assignment; absent only for unresolved legacy rows. */
  dataCellId?: DataCellId
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

export type PropertyGoogleBindingChanged = Readonly<{
  _tag: 'property.google_binding.changed'
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  connectionId: GoogleConnectionId
  sourceEpoch: number
  change: 'created' | 'relinked' | 'disconnected' | 'deletion_started'
  occurredAt: Date
  correlationId: string | null
}>

export const propertyGoogleBindingChanged = (
  args: Omit<PropertyGoogleBindingChanged, '_tag' | 'eventId' | 'correlationId'>,
): PropertyGoogleBindingChanged => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(
    Number.isSafeInteger(args.sourceEpoch) && args.sourceEpoch >= 0,
    'sourceEpoch invalid',
  )
  return {
    _tag: 'property.google_binding.changed',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export type PropertyEvent =
  PropertyCreated | PropertyUpdated | PropertyDeleted | PropertyGoogleBindingChanged
