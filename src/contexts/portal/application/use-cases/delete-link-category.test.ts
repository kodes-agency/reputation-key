// Portal context — delete link category use case tests

import { describe, it, expect, vi } from 'vitest'
import { deleteLinkCategory } from './delete-link-category'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalLinkRepo } from '#/shared/testing/in-memory-portal-link-repo'
import {
  buildTestAuthContext,
  buildTestPortal,
  buildTestPortalLink,
  buildTestPortalLinkCategory,
} from '#/shared/testing/fixtures'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { propertyId, type PropertyId } from '#/shared/domain/ids'
import { isPortalError } from '../../domain/errors'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const setup = (accessible: ReadonlyArray<PropertyId> | null = null) => {
  const portalRepo = createInMemoryPortalRepo()
  const portalLinkRepo = createInMemoryPortalLinkRepo()
  const events = createCapturingEventBus()
  const useCase = deleteLinkCategory({
    portalRepo,
    portalLinkRepo,
    staffPublicApi: staffApiMock(accessible),
    commandStore: createInMemoryPortalCommandStore({
      portalRepo,
      portalLinkRepo,
      events,
    }),
    clock: () => FIXED_TIME,
  })
  return { useCase, portalRepo, portalLinkRepo, events }
}

describe('deleteLinkCategory', () => {
  it('deletes an existing category', async () => {
    const { useCase, portalRepo, portalLinkRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])
    portalRepo.seed([buildTestPortal({})])

    await useCase({ categoryId: category.id }, ctx)

    expect(portalLinkRepo.allCategories()).toHaveLength(0)
    expect(events.capturedByTag('portal_link_category.deleted')).toEqual([
      expect.objectContaining({ categoryId: category.id, occurredAt: FIXED_TIME }),
    ])
  })

  it('rejects when content advanced after the atomic category snapshot', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const previousRevision = new Date('2026-04-10T12:00:00.000Z')
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])
    portalLinkRepo.seedLinks([buildTestPortalLink({ categoryId: category.id })])
    portalRepo.seed([
      buildTestPortal({ updatedAt: new Date(previousRevision.getTime() + 1) }),
    ])
    vi.spyOn(portalLinkRepo, 'findCategoryCommandTarget').mockResolvedValueOnce({
      category,
      portalUpdatedAt: previousRevision,
    })

    await expect(useCase({ categoryId: category.id }, ctx)).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'revision_conflict',
    )
    expect(portalLinkRepo.allCategories()).toHaveLength(1)
    expect(portalLinkRepo.allLinks()).toHaveLength(1)
  })

  it('rejects users who cannot delete', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(useCase({ categoryId: 'any' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'forbidden',
    )
  })

  it('rejects when category not found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(useCase({ categoryId: 'nonexistent' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'category_not_found',
    )
  })

  it('rejects PropertyManager without assignment to the property', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup([])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])
    portalRepo.seed([buildTestPortal({})])

    await expect(useCase({ categoryId: category.id }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'forbidden',
    )
  })

  it('allows PropertyManager assigned to the property', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup([
      propertyId('a0000000-0000-0000-0000-000000000001'),
    ])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])
    portalRepo.seed([buildTestPortal({})])

    await useCase({ categoryId: category.id }, ctx)

    expect(portalLinkRepo.allCategories()).toHaveLength(0)
  })
})
