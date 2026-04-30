// Portal context — delete link use case tests

import { describe, it, expect } from 'vitest'
import { deleteLink } from './delete-link'
import { createInMemoryPortalLinkRepo } from '#/shared/testing/in-memory-portal-link-repo'
import { buildTestAuthContext, buildTestPortalLink } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'

const setup = () => {
  const portalLinkRepo = createInMemoryPortalLinkRepo()
  const useCase = deleteLink({ portalLinkRepo })
  return { useCase, portalLinkRepo }
}

describe('deleteLink', () => {
  it('deletes an existing link', async () => {
    const { useCase, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const link = buildTestPortalLink({})
    portalLinkRepo.seedLinks([link])

    await useCase({ linkId: link.id }, ctx)

    expect(portalLinkRepo.allLinks()).toHaveLength(0)
  })

  it('rejects users who cannot delete', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(useCase({ linkId: 'any' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('rejects when link not found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(useCase({ linkId: 'nonexistent' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'link_not_found',
    )
  })
})
