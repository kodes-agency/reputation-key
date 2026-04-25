// Team context — repository port
// Per architecture: every method takes organizationId as the first parameter.

import type { Team, TeamId } from '../../domain/types'
import type { OrganizationId } from '#/shared/domain/ids'
import type { PropertyId } from '#/shared/domain/ids'

export type TeamRepository = Readonly<{
  findById: (orgId: OrganizationId, id: TeamId) => Promise<Team | null>
  listByProperty: (
    orgId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<ReadonlyArray<Team>>
  nameExistsInProperty: (
    orgId: OrganizationId,
    propertyId: PropertyId,
    name: string,
    excludeId?: TeamId,
  ) => Promise<boolean>
  insert: (orgId: OrganizationId, team: Team) => Promise<void>
  update: (
    orgId: OrganizationId,
    id: TeamId,
    patch: Readonly<Partial<Team>>,
  ) => Promise<void>
  softDelete: (orgId: OrganizationId, id: TeamId) => Promise<void>
}>
