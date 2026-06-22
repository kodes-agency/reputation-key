// Portal context — delete link category use case tests

import { describe, it, expect } from 'vitest'
import { deleteLinkCategory } from './delete-link-category'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalLinkRepo } from '#/shared/testing/in-memory-portal-link-repo'
import {
  buildTestAuthContext,
  buildTestPortal,
  buildTestPortalLinkCategory,
} from '#/shared/testing/fixtures'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { propertyId, type PropertyId } from '#/shared/domain/ids'
import { isPortalError } from '../../domain/errors'

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})

const setup = (accessible: ReadonlyArray<PropertyId> | null = null) => {
  const portalRepo = createInMemoryPortalRepo()
  const portalLinkRepo = createInMemoryPortalLinkRepo()
  const useCase = deleteLinkCategory({
    portalRepo,
    portalLinkRepo,
    staffPublicApi: staffApiMock(accessible),
  })
  return { useCase, portalRepo, portalLinkRepo }
}

describe('deleteLinkCategory', () => {
  it('deletes an existing category', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])
    portalRepo.seed([buildTestPortal({})])

    await useCase({ categoryId: category.id }, ctx)

    expect(portalLinkRepo.allCategories()).toHaveLength(0)
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
