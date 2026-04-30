// Portal context — reorder categories use case tests

import { describe, it, expect } from 'vitest'
import { reorderCategories } from './reorder-categories'
import { createInMemoryPortalLinkRepo } from '#/shared/testing/in-memory-portal-link-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext, buildTestPortalLinkCategory } from '#/shared/testing/fixtures'
import { portalLinkCategoryId } from '#/shared/domain/ids'
import { isPortalError } from '../../domain/errors'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = () => {
  const portalLinkRepo = createInMemoryPortalLinkRepo()
  const events = createCapturingEventBus()
  const deps = { portalLinkRepo, events, clock: () => FIXED_TIME }
  const useCase = reorderCategories(deps)
  return { useCase, portalLinkRepo, events }
}

describe('reorderCategories', () => {
  it('reorders categories with new sort keys', async () => {
    const { useCase, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const cat1 = buildTestPortalLinkCategory({ id: portalLinkCategoryId('cat-1'), sortKey: 'a0' })
    const cat2 = buildTestPortalLinkCategory({ id: portalLinkCategoryId('cat-2'), sortKey: 'a1' })
    portalLinkRepo.seedCategories([cat1, cat2])

    await useCase(
      {
        portalId: 'd0000000-0000-0000-0000-000000000001',
        items: [
          { id: cat2.id, sortKey: 'a0' },
          { id: cat1.id, sortKey: 'a1' },
        ],
      },
      ctx,
    )

    const updated = portalLinkRepo.allCategories()
    expect(updated.find((c) => c.id === cat2.id)?.sortKey).toBe('a0')
    expect(updated.find((c) => c.id === cat1.id)?.sortKey).toBe('a1')
  })

  it('rejects users who cannot update', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(
      useCase({ portalId: 'any', items: [] }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('emits portal_link_category.reordered event', async () => {
    const { useCase, portalLinkRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const cat1 = buildTestPortalLinkCategory({ id: portalLinkCategoryId('cat-1') })
    portalLinkRepo.seedCategories([cat1])

    await useCase(
      { portalId: 'd0000000-0000-0000-0000-000000000001', items: [{ id: cat1.id, sortKey: 'b0' }] },
      ctx,
    )

    const emitted = events.capturedByTag('portal_link_category.reordered')
    expect(emitted).toHaveLength(1)
  })
})
