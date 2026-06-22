// Portal context — delete link use case tests

import { describe, it, expect } from 'vitest'
import { deleteLink } from './delete-link'
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

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})

const setup = (accessible: ReadonlyArray<PropertyId> | null = null) => {
  const portalRepo = createInMemoryPortalRepo()
  const portalLinkRepo = createInMemoryPortalLinkRepo()
  const useCase = deleteLink({
    portalRepo,
    portalLinkRepo,
    staffPublicApi: staffApiMock(accessible),
  })
  return { useCase, portalRepo, portalLinkRepo }
}

describe('deleteLink', () => {
  it('deletes an existing link', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const link = buildTestPortalLink({})
    portalLinkRepo.seedLinks([link])

    await useCase({ linkId: link.id }, ctx)

    expect(portalLinkRepo.allLinks()).toHaveLength(0)
  })

  it('rejects users who cannot delete', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(useCase({ linkId: 'any' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'forbidden',
    )
  })

  it('rejects when link not found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(useCase({ linkId: 'nonexistent' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'link_not_found',
    )
  })

  it('rejects PropertyManager without assignment to the property', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup([])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const link = buildTestPortalLink({})
    portalLinkRepo.seedLinks([link])

    await expect(useCase({ linkId: link.id }, ctx)).rejects.toSatisfy(
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

    await useCase({ linkId: link.id }, ctx)

    expect(portalLinkRepo.allLinks()).toHaveLength(0)
  })
})
