import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { portalId, portalLinkCategoryId } from '#/shared/domain/ids'
import { createPortalScopeRepository } from './repositories/portal-scope.repository'

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
    db: {
      select: vi.fn(() => chain),
      selectDistinct: vi.fn(() => chain),
    } as unknown as Database,
    chain,
  }
}

describe('createPortalScopeRepository', () => {
  it('resolves a non-deleted portal to its tenant and property scope', async () => {
    const scope = {
      organizationId: 'org-1',
      propertyId: 'property-1',
      portalId: 'portal-1',
    }
    const { db, chain } = databaseReturning([scope])

    await expect(
      createPortalScopeRepository(db).resolvePortal(portalId('portal-1')),
    ).resolves.toEqual(scope)
    expect(chain.where).toHaveBeenCalledOnce()
    expect(chain.limit).toHaveBeenCalledWith(1)
  })

  it('requires the parent portal join when resolving a category scope', async () => {
    const scope = {
      organizationId: 'org-1',
      propertyId: 'property-1',
      portalId: 'portal-1',
    }
    const { db, chain } = databaseReturning([scope])

    await expect(
      createPortalScopeRepository(db).resolveCategory(portalLinkCategoryId('category-1')),
    ).resolves.toEqual(scope)
    expect(chain.innerJoin).toHaveBeenCalledOnce()
  })

  it('returns null for an inaccessible scope and lists only selected property IDs', async () => {
    await expect(
      createPortalScopeRepository(databaseReturning([]).db).resolvePortal(
        portalId('missing'),
      ),
    ).resolves.toBeNull()

    const { db } = databaseReturning([
      { propertyId: 'property-1' },
      { propertyId: 'property-2' },
    ])
    await expect(
      createPortalScopeRepository(db).listPortalPropertyIds('org-1'),
    ).resolves.toEqual(['property-1', 'property-2'])
  })
})
