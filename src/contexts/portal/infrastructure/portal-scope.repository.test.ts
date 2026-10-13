import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import {
  portalGroupId,
  portalId,
  portalLinkCategoryId,
  portalLinkId,
} from '#/shared/domain/ids'
import { createPortalScopeRepository } from './repositories/portal-scope.repository'

const PORTAL_ID = '5c09e000-0000-4000-8000-000000000001'
const CATEGORY_ID = '5c09e000-0000-4000-8000-000000000002'
const MISSING_ID = '5c09e000-0000-4000-8000-0000000000ff'

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
      createPortalScopeRepository(db).resolvePortal(portalId(PORTAL_ID)),
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
      createPortalScopeRepository(db).resolveCategory(portalLinkCategoryId(CATEGORY_ID)),
    ).resolves.toEqual(scope)
    expect(chain.innerJoin).toHaveBeenCalledOnce()
  })

  it('returns null for an inaccessible scope and lists only selected property IDs', async () => {
    await expect(
      createPortalScopeRepository(databaseReturning([]).db).resolvePortal(
        portalId(MISSING_ID),
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

  // The columns are `uuid`: an id that is not one names no row, and asking
  // PostgreSQL would be a refused cast (the integration test shows it).
  it('answers null for an id that is not a UUID without asking the database', async () => {
    const row = { organizationId: 'org-1', propertyId: 'property-1' }
    const { db } = databaseReturning([row])
    const scopes = createPortalScopeRepository(db)

    await expect(scopes.resolvePortal(portalId('portal-p2'))).resolves.toBeNull()
    await expect(scopes.resolveGroup(portalGroupId('x'))).resolves.toBeNull()
    await expect(
      scopes.resolveCategory(portalLinkCategoryId(`${CATEGORY_ID}0`)),
    ).resolves.toBeNull()
    await expect(scopes.resolveLink(portalLinkId(' '))).resolves.toBeNull()
    expect(db.select).not.toHaveBeenCalled()
  })
})
