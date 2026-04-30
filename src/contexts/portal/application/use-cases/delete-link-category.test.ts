// Portal context — delete link category use case tests

import { describe, it, expect } from 'vitest'
import { deleteLinkCategory } from './delete-link-category'
import { createInMemoryPortalLinkRepo } from '#/shared/testing/in-memory-portal-link-repo'
import { buildTestAuthContext, buildTestPortalLinkCategory } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'

const setup = () => {
  const portalLinkRepo = createInMemoryPortalLinkRepo()
  const useCase = deleteLinkCategory({ portalLinkRepo })
  return { useCase, portalLinkRepo }
}

describe('deleteLinkCategory', () => {
  it('deletes an existing category', async () => {
    const { useCase, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])

    await useCase({ categoryId: category.id }, ctx)

    expect(portalLinkRepo.allCategories()).toHaveLength(0)
  })

  it('rejects users who cannot delete', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(useCase({ categoryId: 'any' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('rejects when category not found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(useCase({ categoryId: 'nonexistent' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'category_not_found',
    )
  })
})
