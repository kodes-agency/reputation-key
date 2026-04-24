// Property context — domain types
// Entity types for the property bounded context.
// Per architecture: types are data only — no methods, no classes.
// readonly on every field. Branded IDs prevent accidental substitution.

import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

/** Property entity — the organizational unit everything else lives under. */
export type Property = Readonly<{
  id: PropertyId
  organizationId: OrganizationId
  name: string
  slug: string
  timezone: string
  gbpPlaceId: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}>

/** Re-export PropertyId from shared for convenience */
export type { PropertyId } from '#/shared/domain/ids'
