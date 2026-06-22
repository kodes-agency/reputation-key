// Portal context — reorder categories use case tests

import { describe, it, expect } from 'vitest'
import { reorderCategories } from './reorder-categories'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalLinkRepo } from '#/shared/testing/in-memory-portal-link-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import {
  buildTestAuthContext,
  buildTestPortal,
  buildTestPortalLinkCategory,
} from '#/shared/testing/fixtures'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { portalLinkCategoryId, propertyId, type PropertyId } from '#/shared/domain/ids'
import { isPortalError } from '../../domain/errors'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})

const setup = (accessible: ReadonlyArray<PropertyId> | null = null) => {
  const portalRepo = createInMemoryPortalRepo()
  const portalLinkRepo = createInMemoryPortalLinkRepo()
  const events = createCapturingEventBus()
  const deps = {
    portalRepo,
    portalLinkRepo,
    staffPublicApi: staffApiMock(accessible),
    events,
    clock: () => FIXED_TIME,
  }
  const useCase = reorderCategories(deps)
  return { useCase, portalRepo, portalLinkRepo, events }
}

describe('reorderCategories', () => {
  it('reorders categories with new sort keys', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    portalRepo.seed([buildTestPortal({})])
    const cat1 = buildTestPortalLinkCategory({
      id: portalLinkCategoryId('cat-1'),
      sortKey: 'a0',
    })
    const cat2 = buildTestPortalLinkCategory({
      id: portalLinkCategoryId('cat-2'),
      sortKey: 'a1',
    })
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

    await expect(useCase({ portalId: 'any', items: [] }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'forbidden',
    )
  })

  it('emits portal_link_category.reordered event', async () => {
    const { useCase, portalRepo, portalLinkRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    portalRepo.seed([buildTestPortal({})])
    const cat1 = buildTestPortalLinkCategory({ id: portalLinkCategoryId('cat-1') })
    portalLinkRepo.seedCategories([cat1])

    await useCase(
      {
        portalId: 'd0000000-0000-0000-0000-000000000001',
        items: [{ id: cat1.id, sortKey: 'b0' }],
      },
      ctx,
    )

    const emitted = events.capturedByTag('portal_link_category.reordered')
    expect(emitted).toHaveLength(1)
  })

  it('rejects PropertyManager without assignment to the property', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup([])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    portalRepo.seed([buildTestPortal({})])
    const cat1 = buildTestPortalLinkCategory({ id: portalLinkCategoryId('cat-1') })
    portalLinkRepo.seedCategories([cat1])

    await expect(
      useCase(
        {
          portalId: 'd0000000-0000-0000-0000-000000000001',
          items: [{ id: cat1.id, sortKey: 'b0' }],
        },
        ctx,
      ),
    ).rejects.toSatisfy((e: unknown) => isPortalError(e) && e.code === 'forbidden')
  })

  it('allows PropertyManager assigned to the property', async () => {
    const { useCase, portalRepo, portalLinkRepo, events } = setup([
      propertyId('a0000000-0000-0000-0000-000000000001'),
    ])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    portalRepo.seed([buildTestPortal({})])
    const cat1 = buildTestPortalLinkCategory({ id: portalLinkCategoryId('cat-1') })
    portalLinkRepo.seedCategories([cat1])

    await useCase(
      {
        portalId: 'd0000000-0000-0000-0000-000000000001',
        items: [{ id: cat1.id, sortKey: 'b0' }],
      },
      ctx,
    )

    expect(events.capturedByTag('portal_link_category.reordered')).toHaveLength(1)
  })
})
