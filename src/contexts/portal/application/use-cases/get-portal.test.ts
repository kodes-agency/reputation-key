// Portal context — get portal use case tests

import { describe, it, expect } from 'vitest'
import { getPortal } from './get-portal'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'

const setup = () => {
  const portalRepo = createInMemoryPortalRepo()
  const useCase = getPortal({ portalRepo })
  return { useCase, portalRepo }
}

describe('getPortal', () => {
  it('returns a portal by id', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({ name: 'Found Portal' })
    portalRepo.seed([portal])

    const result = await useCase({ portalId: portal.id }, ctx)

    expect(result.name).toBe('Found Portal')
  })

  it('rejects when portal not found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext()

    await expect(useCase({ portalId: 'nonexistent' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'portal_not_found',
    )
  })

  it('rejects when portal belongs to another organization', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext({ organizationId: 'org-00000000-0000-0000-0000-000000000002' as unknown as import('#/shared/domain/ids').OrganizationId })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    await expect(useCase({ portalId: portal.id }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'portal_not_found',
    )
  })
})
