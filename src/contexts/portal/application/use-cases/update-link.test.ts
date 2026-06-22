// Portal context — update link use case tests

import { describe, it, expect } from 'vitest'
import { updateLink } from './update-link'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalLinkRepo } from '#/shared/testing/in-memory-portal-link-repo'
import {
  buildTestAuthContext,
  buildTestPortal,
  buildTestPortalLink,
} from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { propertyId, type PropertyId } from '#/shared/domain/ids'

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
  const useCase = updateLink(deps)
  return { useCase, portalRepo, portalLinkRepo }
}

describe('updateLink', () => {
  it('updates link label and URL', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
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
      (e: unknown) => isPortalError(e) && e.code === 'forbidden',
    )
  })

  it('rejects when link not found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ linkId: 'nonexistent', label: 'Test' }, ctx),
    ).rejects.toSatisfy((e: unknown) => isPortalError(e) && e.code === 'link_not_found')
  })

  it('rejects empty label', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const link = buildTestPortalLink({})
    portalLinkRepo.seedLinks([link])

    await expect(useCase({ linkId: link.id, label: '' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'invalid_label',
    )
  })

  it('rejects invalid URL', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const link = buildTestPortalLink({})
    portalLinkRepo.seedLinks([link])

    await expect(useCase({ linkId: link.id, url: 'bad-url' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'invalid_url',
    )
  })

  it('returns existing link unchanged when no fields provided', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const link = buildTestPortalLink({ label: 'Original' })
    portalLinkRepo.seedLinks([link])

    const updated = await useCase({ linkId: link.id }, ctx)

    expect(updated.label).toBe('Original')
  })

  it('rejects PropertyManager without assignment to the property', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup([])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const link = buildTestPortalLink({})
    portalLinkRepo.seedLinks([link])

    await expect(useCase({ linkId: link.id, label: 'New' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'forbidden',
    )
  })

  it('allows PropertyManager assigned to the property', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup([
      propertyId('a0000000-0000-0000-0000-000000000001'),
    ])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const link = buildTestPortalLink({})
    portalLinkRepo.seedLinks([link])

    const updated = await useCase({ linkId: link.id, label: 'New' }, ctx)

    expect(updated.label).toBe('New')
  })
})
