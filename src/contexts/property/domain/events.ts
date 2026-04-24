// Property context — domain events
// Per architecture: "Events are facts, named in the past tense."
// Events live in their owning context's domain/events.ts.

import type { PropertyId } from './types'
import type { OrganizationId } from '#/shared/domain/ids'

export type PropertyCreated = Readonly<{
  _tag: 'property.created'
  propertyId: PropertyId
  organizationId: OrganizationId
  name: string
  slug: string
  occurredAt: Date
}>

export type PropertyUpdated = Readonly<{
  _tag: 'property.updated'
  propertyId: PropertyId
  organizationId: OrganizationId
  name: string
  slug: string
  occurredAt: Date
}>

export type PropertyDeleted = Readonly<{
  _tag: 'property.deleted'
  propertyId: PropertyId
  organizationId: OrganizationId
  occurredAt: Date
}>

export type PropertyEvent = PropertyCreated | PropertyUpdated | PropertyDeleted

// ── Event constructors ──────────────────────────────────────────────

export const propertyCreated = (
  args: Omit<PropertyCreated, '_tag'>,
): PropertyCreated => ({ _tag: 'property.created', ...args })

export const propertyUpdated = (
  args: Omit<PropertyUpdated, '_tag'>,
): PropertyUpdated => ({ _tag: 'property.updated', ...args })

export const propertyDeleted = (
  args: Omit<PropertyDeleted, '_tag'>,
): PropertyDeleted => ({ _tag: 'property.deleted', ...args })
