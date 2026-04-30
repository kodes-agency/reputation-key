// Portal context — update link category use case tests

import { describe, it, expect } from 'vitest'
import { updateLinkCategory } from './update-link-category'
import { createInMemoryPortalLinkRepo } from '#/shared/testing/in-memory-portal-link-repo'
import { buildTestAuthContext, buildTestPortalLinkCategory } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = () => {
  const portalLinkRepo = createInMemoryPortalLinkRepo()
  const deps = { portalLinkRepo, clock: () => FIXED_TIME }
  const useCase = updateLinkCategory(deps)
  return { useCase, portalLinkRepo }
}

describe('updateLinkCategory', () => {
  it('updates category title', async () => {
    const { useCase, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])

    const updated = await useCase({ categoryId: category.id, title: 'New Title' }, ctx)

    expect(updated.title).toBe('New Title')
  })

  it('rejects users who cannot update', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(useCase({ categoryId: 'any', title: 'Test' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('rejects when category not found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ categoryId: 'nonexistent', title: 'Test' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'category_not_found',
    )
  })

  it('rejects empty title', async () => {
    const { useCase, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])

    await expect(
      useCase({ categoryId: category.id, title: '' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'invalid_title',
    )
  })

  it('returns existing category unchanged when no title provided', async () => {
    const { useCase, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const category = buildTestPortalLinkCategory({ title: 'Original' })
    portalLinkRepo.seedCategories([category])

    const updated = await useCase({ categoryId: category.id }, ctx)

    expect(updated.title).toBe('Original')
  })
})
