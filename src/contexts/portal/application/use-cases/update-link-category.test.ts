// Portal context — update link category use case tests

import { describe, it, expect } from 'vitest'
import { updateLinkCategory } from './update-link-category'
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

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})

const setup = (accessible: ReadonlyArray<PropertyId> | null = null) => {
  const portalRepo = createInMemoryPortalRepo()
  const portalLinkRepo = createInMemoryPortalLinkRepo()
  const deps = {
    portalRepo,
    portalLinkRepo,
    staffPublicApi: staffApiMock(accessible),
    clock: () => FIXED_TIME,
  }
  const useCase = updateLinkCategory(deps)
  return { useCase, portalRepo, portalLinkRepo }
}

describe('updateLinkCategory', () => {
  it('updates category title', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])
    portalRepo.seed([buildTestPortal({})])

    const updated = await useCase({ categoryId: category.id, title: 'New Title' }, ctx)

    expect(updated.title).toBe('New Title')
  })

  it('rejects users who cannot update', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(useCase({ categoryId: 'any', title: 'Test' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'forbidden',
    )
  })

  it('rejects when category not found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ categoryId: 'nonexistent', title: 'Test' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'category_not_found',
    )
  })

  it('rejects empty title', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])
    portalRepo.seed([buildTestPortal({})])

    await expect(useCase({ categoryId: category.id, title: '' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'invalid_title',
    )
  })

  it('returns existing category unchanged when no title provided', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const category = buildTestPortalLinkCategory({ title: 'Original' })
    portalLinkRepo.seedCategories([category])
    portalRepo.seed([buildTestPortal({})])

    const updated = await useCase({ categoryId: category.id }, ctx)

    expect(updated.title).toBe('Original')
  })

  it('rejects PropertyManager without assignment to the property', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup([])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])
    portalRepo.seed([buildTestPortal({})])

    await expect(
      useCase({ categoryId: category.id, title: 'New' }, ctx),
    ).rejects.toSatisfy((e: unknown) => isPortalError(e) && e.code === 'forbidden')
  })

  it('allows PropertyManager assigned to the property', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup([
      propertyId('a0000000-0000-0000-0000-000000000001'),
    ])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])
    portalRepo.seed([buildTestPortal({})])

    const updated = await useCase({ categoryId: category.id, title: 'Updated' }, ctx)

    expect(updated.title).toBe('Updated')
  })
})
