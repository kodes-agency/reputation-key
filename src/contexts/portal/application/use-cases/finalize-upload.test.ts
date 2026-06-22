// Portal context — finalize upload use case tests

import { describe, it, expect } from 'vitest'
import { finalizeUpload } from './finalize-upload'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
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
  const storage = {
    createPresignedUploadUrl: async (
      _key: string,
      _contentType: string,
      _maxSize: number,
    ) => ({
      uploadUrl: 'https://r2.example.com/presigned',
      key: 'test-key',
    }),
    confirmUpload: async (_key: string) => 'https://cdn.example.com/test-key',
    deleteObject: async (_key: string) => {},
    getPublicUrl: (_key: string) => `https://cdn.example.com/${_key}`,
    putObject: async (_key: string, _body: Buffer, _contentType: string) => {},
  }
  const deps = {
    portalRepo,
    storage,
    staffPublicApi: staffApiMock(accessible),
    clock: () => FIXED_TIME,
    queue: undefined,
  }
  const useCase = finalizeUpload(deps)
  return { useCase, portalRepo }
}

describe('finalizeUpload', () => {
  it('updates portal hero image URL', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    const result = await useCase({ portalId: portal.id, key: 'test-key' }, ctx)

    expect(result.heroImageUrl).toBe('https://cdn.example.com/test-key')

    const updated = await portalRepo.findById(ctx.organizationId, portal.id)
    expect(updated?.heroImageUrl).toBe('https://cdn.example.com/test-key')
  })

  it('rejects when portal not found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext()

    await expect(
      useCase({ portalId: 'nonexistent', key: 'test-key' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isPortalError(e) && (e as { code: string }).code === 'portal_not_found',
    )
  })

  it('rejects when role lacks portal.update permission', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    await expect(
      useCase({ portalId: portal.id, key: 'uploads/test.jpg' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'forbidden',
    )
  })
  it('rejects PropertyManager without assignment to the property', async () => {
    const { useCase, portalRepo } = setup([])
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    await expect(
      useCase({ portalId: portal.id, key: 'test-key' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('allows PropertyManager assigned to the property', async () => {
    const { useCase, portalRepo } = setup([
      propertyId('a0000000-0000-0000-0000-000000000001'),
    ])
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    const result = await useCase({ portalId: portal.id, key: 'test-key' }, ctx)

    expect(result.heroImageUrl).toBe('https://cdn.example.com/test-key')
  })
})
