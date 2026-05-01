// In-memory TeamRepository fake — for use in use case tests.
// Implements the same port interface so use cases can't tell the difference.
// Extra test-only methods (seed, all) allow tests to set up state.

import type { TeamRepository } from '#/contexts/team/application/ports/team.repository'
import type { Team } from '#/contexts/team/domain/types'
import type { OrganizationId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type InMemoryTeamRepo = TeamRepository &
  Readonly<{
    seed: (teams: ReadonlyArray<Team>) => void
    all: () => ReadonlyArray<Team>
  }>

export const createInMemoryTeamRepo = (): InMemoryTeamRepo => {
  const store = new Map<string, Team>()

  const isAccessible = (orgId: OrganizationId, team: Team) =>
    team.organizationId === orgId && team.deletedAt === null

  return {
    findById: async (orgId, id) => {
      const team = store.get(String(id))
      return team && isAccessible(orgId, team) ? team : null
    },

    listByProperty: async (orgId, propertyId) =>
      [...store.values()].filter(
        (t) => isAccessible(orgId, t) && t.propertyId === propertyId,
      ),

    nameExistsInProperty: async (orgId, propertyId, name, excludeId) =>
      [...store.values()].some(
        (t) =>
          isAccessible(orgId, t) &&
          t.propertyId === propertyId &&
          t.name === name &&
          (excludeId === undefined || t.id !== excludeId),
      ),

    insert: async (_orgId, team) => {
      store.set(String(team.id), team)
    },

    update: async (orgId, id, patch) => {
      const existing = store.get(String(id))
      if (!existing || !isAccessible(orgId, existing)) return
      store.set(String(id), { ...existing, ...patch } as Team)
    },

    softDelete: async (orgId, id) => {
      const existing = store.get(String(id))
      if (!existing || !isAccessible(orgId, existing)) return
      store.set(String(id), {
        ...existing,
        deletedAt: new Date(),
        updatedAt: new Date(),
      } as Team)
    },

    // ── Test-only helpers ───────────────────────────────────────────

    seed: (teams) => {
      for (const t of teams) store.set(String(t.id), t)
    },

    all: () => [...store.values()],
  }
}
