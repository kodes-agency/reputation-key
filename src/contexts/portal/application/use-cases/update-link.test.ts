// Portal context — update link use case tests

import { describe, it, expect } from 'vitest'
import { updateLink } from './update-link'
import { createInMemoryPortalLinkRepo } from '#/shared/testing/in-memory-portal-link-repo'
import { buildTestAuthContext, buildTestPortalLink } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = () => {
  const portalLinkRepo = createInMemoryPortalLinkRepo()
  const deps = { portalLinkRepo, clock: () => FIXED_TIME }
  const useCase = updateLink(deps)
  return { useCase, portalLinkRepo }
}

describe('updateLink', () => {
  it('updates link label and URL', async () => {
    const { useCase, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const link = buildTestPortalLink({})
    portalLinkRepo.seedLinks([link])

    const updated = await useCase(
      { linkId: link.id, label: 'New Label', url: 'https://new.com' },
      ctx,
    )

    expect(updated.label).toBe('New Label')
    expect(updated.url).toBe('https://new.com')
  })

  it('rejects users who cannot update', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(useCase({ linkId: 'any', label: 'Test' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('rejects when link not found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ linkId: 'nonexistent', label: 'Test' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'link_not_found',
    )
  })

  it('rejects empty label', async () => {
    const { useCase, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const link = buildTestPortalLink({})
    portalLinkRepo.seedLinks([link])

    await expect(
      useCase({ linkId: link.id, label: '' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'invalid_label',
    )
  })

  it('rejects invalid URL', async () => {
    const { useCase, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const link = buildTestPortalLink({})
    portalLinkRepo.seedLinks([link])

    await expect(
      useCase({ linkId: link.id, url: 'bad-url' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'invalid_url',
    )
  })

  it('returns existing link unchanged when no fields provided', async () => {
    const { useCase, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const link = buildTestPortalLink({ label: 'Original' })
    portalLinkRepo.seedLinks([link])

    const updated = await useCase({ linkId: link.id }, ctx)

    expect(updated.label).toBe('Original')
  })
})
