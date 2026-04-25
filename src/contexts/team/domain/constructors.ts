// Team context — domain constructors (smart constructors)
// Pure — ID and time are inputs, no side effects.

import { Result } from 'neverthrow'
import type { Team, TeamId } from './types'
import type { TeamError } from './errors'
import type { OrganizationId, UserId, PropertyId } from '#/shared/domain/ids'
import { validateTeamName } from './rules'

export type BuildTeamInput = Readonly<{
  id: TeamId
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  description?: string | null
  teamLeadId?: UserId | null
  now: Date
}>

export const buildTeam = (input: BuildTeamInput): Result<Team, TeamError> => {
  const nameResult = validateTeamName(input.name)

  return nameResult.map(
    (validName): Team => ({
      id: input.id,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      name: validName,
      description: input.description ?? null,
      teamLeadId: input.teamLeadId ?? null,
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
    }),
  )
}
