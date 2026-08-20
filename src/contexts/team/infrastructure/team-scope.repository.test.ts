import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { teamId } from '#/shared/domain/ids'
import { createTeamScopeRepository } from './repositories/team-scope.repository'

function databaseReturning(rows: readonly unknown[]) {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.innerJoin = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.limit = vi.fn(async () => rows)
  chain.then = (
    resolve: (value: readonly unknown[]) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(rows).then(resolve, reject)
  return {
    db: { select: vi.fn(() => chain) } as unknown as Database,
    chain,
  }
}

describe('createTeamScopeRepository', () => {
  it('resolves a non-deleted team to its organization and property scope', async () => {
    const scope = {
      organizationId: 'org-1',
      propertyId: 'property-1',
      teamId: 'team-1',
    }
    const { db, chain } = databaseReturning([scope])

    await expect(
      createTeamScopeRepository(db).resolveTeam(teamId('team-1')),
    ).resolves.toEqual(scope)
    expect(chain.where).toHaveBeenCalledOnce()
    expect(chain.limit).toHaveBeenCalledWith(1)
  })

  it('returns null for unresolved team and participation scopes', async () => {
    const teamDb = databaseReturning([]).db
    const participationDb = databaseReturning([]).db

    await expect(
      createTeamScopeRepository(teamDb).resolveTeam(teamId('missing')),
    ).resolves.toBeNull()
    await expect(
      createTeamScopeRepository(participationDb).resolveParticipation('missing'),
    ).resolves.toBeNull()
  })

  it('returns only the active membership scopes selected for the requested user', async () => {
    const memberships = [
      {
        organizationId: 'org-1',
        propertyId: 'property-1',
        teamId: 'team-1',
        role: 'lead',
      },
    ] as const
    const { db, chain } = databaseReturning(memberships)

    await expect(
      createTeamScopeRepository(db).listActiveForUser('org-1', 'user-1'),
    ).resolves.toEqual(memberships)
    expect(chain.innerJoin).toHaveBeenCalledTimes(2)
    expect(chain.where).toHaveBeenCalledOnce()
  })
})
