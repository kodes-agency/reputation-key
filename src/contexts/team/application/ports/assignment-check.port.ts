// Team context — assignment check port
// Anti-corruption layer: team context must not import staff context directly.
// Staff build.ts wires this up with its own repository.

import type { OrganizationId, TeamId } from '#/shared/domain/ids'

export type AssignmentCheckPort = Readonly<{
  countByTeam: (orgId: OrganizationId, teamId: TeamId) => Promise<number>
}>
