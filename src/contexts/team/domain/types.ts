// Team context — domain types
// Teams belong to a property within an organization.
// Per architecture: types are data only — no methods, no classes.
// readonly on every field. Branded IDs prevent accidental substitution.

import type { OrganizationId, PropertyId, TeamId, UserId } from '#/shared/domain/ids'

/** Team entity — groups staff within a property. */
export type Team = Readonly<{
  id: TeamId
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  description: string | null
  teamLeadId: UserId | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}>

/** Re-export TeamId from shared for convenience */
export type { TeamId } from '#/shared/domain/ids'
