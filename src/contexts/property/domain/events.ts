// Property context — domain events
// Standards: docs/standards.md §1

import type { PropertyId } from './types'
import type { GoogleConnectionId, OrganizationId, UserId } from '#/shared/domain/ids'
import { newEventId } from '#/shared/domain/event-id'
import { assert } from '#/shared/domain/assert'
import type { PropertyLifecycleState } from './property-lifecycle'

export type PropertyCreated = Readonly<{
  _tag: 'property.created'
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  slug: string
  occurredAt: Date
  correlationId: string | null
}>
export const propertyCreated = (
  args: Omit<PropertyCreated, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): PropertyCreated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    ...args,
    _tag: 'property.created',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
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
  args: Omit<PropertyUpdated, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): PropertyUpdated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    ...args,
    _tag: 'property.updated',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
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
  args: Omit<PropertyDeleted, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): PropertyDeleted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    ...args,
    _tag: 'property.deleted',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
  }
}

export type PropertyArchived = Readonly<{
  _tag: 'property.archived'
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  userId: UserId
  previousState: Extract<PropertyLifecycleState, 'active' | 'suspended'>
  sourceEpoch: number
  recoveryDeadline: Date
  occurredAt: Date
  correlationId: string | null
}>

export const propertyArchived = (
  args: Omit<PropertyArchived, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): PropertyArchived => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.recoveryDeadline instanceof Date, 'recoveryDeadline must be Date')
  assert(
    args.previousState === 'active' || args.previousState === 'suspended',
    'previousState invalid',
  )
  assert(
    args.recoveryDeadline.getTime() > args.occurredAt.getTime(),
    'recoveryDeadline must follow occurredAt',
  )
  assert(
    Number.isSafeInteger(args.sourceEpoch) && args.sourceEpoch >= 1,
    'sourceEpoch invalid',
  )
  return {
    ...args,
    _tag: 'property.archived',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
  }
}

export type PropertyRestored = Readonly<{
  _tag: 'property.restored'
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  userId: UserId
  previousState: Extract<PropertyLifecycleState, 'archived'>
  sourceEpoch: number
  googleBindingReadiness: 'ready' | 'reconnect_required'
  occurredAt: Date
  correlationId: string | null
}>

export const propertyRestored = (
  args: Omit<PropertyRestored, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): PropertyRestored => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.previousState === 'archived', 'previousState invalid')
  assert(
    Number.isSafeInteger(args.sourceEpoch) && args.sourceEpoch >= 1,
    'sourceEpoch invalid',
  )
  return {
    ...args,
    _tag: 'property.restored',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
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
  args: Omit<PropertyGoogleBindingChanged, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): PropertyGoogleBindingChanged => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(
    Number.isSafeInteger(args.sourceEpoch) && args.sourceEpoch >= 0,
    'sourceEpoch invalid',
  )
  return {
    ...args,
    _tag: 'property.google_binding.changed',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
  }
}

export type PropertyResponsibilityNeeded = Readonly<{
  _tag: 'property.responsibility_became_needed'
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  occurredAt: Date
  correlationId: string | null
}>

export const propertyResponsibilityNeeded = (
  args: Omit<PropertyResponsibilityNeeded, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): PropertyResponsibilityNeeded => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    ...args,
    _tag: 'property.responsibility_became_needed',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
  }
}

export type PropertyEvent =
  | PropertyCreated
  | PropertyUpdated
  | PropertyDeleted
  | PropertyArchived
  | PropertyRestored
  | PropertyGoogleBindingChanged
  | PropertyResponsibilityNeeded
