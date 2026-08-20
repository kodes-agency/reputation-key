import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { createGovernedGoalRepository } from './repositories/governed-goal.repository'

function databaseReturning(rows: readonly unknown[]) {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.orderBy = vi.fn(() => chain)
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

describe('createGovernedGoalRepository', () => {
  it('resolves a definition envelope only through the scoped query', async () => {
    const scope = {
      organizationId: 'org-1',
      propertyId: 'property-1',
      definitionId: 'definition-1',
    }
    const { db, chain } = databaseReturning([scope])

    await expect(
      createGovernedGoalRepository(db).getDefinitionScope('org-1', 'definition-1'),
    ).resolves.toEqual(scope)
    expect(chain.where).toHaveBeenCalledOnce()
    expect(chain.limit).toHaveBeenCalledWith(1)
  })

  it('returns null when no definition exists in the requested tenant scope', async () => {
    await expect(
      createGovernedGoalRepository(databaseReturning([]).db).getDefinition(
        'org-1',
        'property-1',
        'definition-missing',
      ),
    ).resolves.toBeNull()
  })

  it('maps portal-group scope without leaking persistence-only columns', async () => {
    const createdAt = new Date('2026-08-01T12:00:00.000Z')
    const updatedAt = new Date('2026-08-16T12:00:00.000Z')
    const row = {
      id: 'definition-1',
      organizationId: 'org-1',
      propertyId: 'property-1',
      scopeKind: 'portal_group',
      portalGroupId: 'group-1',
      name: 'Monthly service score',
      description: null,
      status: 'active',
      statusReason: null,
      currentVersion: 2,
      createdBy: 'user-1',
      createdAt,
      updatedAt,
      internalNote: 'must not escape',
    }

    await expect(
      createGovernedGoalRepository(databaseReturning([row]).db).getDefinition(
        'org-1',
        'property-1',
        'definition-1',
      ),
    ).resolves.toEqual({
      id: 'definition-1',
      organizationId: 'org-1',
      propertyId: 'property-1',
      scope: { kind: 'portal_group', portalGroupId: 'group-1' },
      name: 'Monthly service score',
      description: null,
      status: 'active',
      statusReason: null,
      currentVersion: 2,
      createdBy: 'user-1',
      createdAt,
      updatedAt,
    })
  })
})
