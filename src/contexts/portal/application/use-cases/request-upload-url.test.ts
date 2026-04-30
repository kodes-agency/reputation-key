// Portal context — request upload URL use case tests

import { describe, it, expect } from 'vitest'
import { requestUploadUrl } from './request-upload-url'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'

const setup = () => {
  const portalRepo = createInMemoryPortalRepo()
  const storage = {
    createPresignedUploadUrl: async (_key: string, _contentType: string, _maxSize: number) => ({
      uploadUrl: 'https://r2.example.com/presigned',
      key: 'portals/org-1/portal-1/hero/test-key',
    }),
    confirmUpload: async (_key: string) => 'https://cdn.example.com/test-key',
    deleteObject: async (_key: string) => {},
    getPublicUrl: (_key: string) => `https://cdn.example.com/${_key}`,
    putObject: async (_key: string, _body: Buffer, _contentType: string) => {},
  }
  const deps = { portalRepo, storage }
  const useCase = requestUploadUrl(deps)
  return { useCase, portalRepo }
}

describe('requestUploadUrl', () => {
  it('returns upload URL for valid image', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    const result = await useCase(
      { portalId: portal.id, contentType: 'image/png', fileSize: 1024 },
      ctx,
    )

    expect(result.uploadUrl).toBe('https://r2.example.com/presigned')
    expect(result.key).toContain('hero/')
  })

  it('rejects when portal not found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext()

    await expect(
      useCase({ portalId: 'nonexistent', contentType: 'image/png', fileSize: 1024 }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'portal_not_found',
    )
  })

  it('rejects disallowed content type', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    await expect(
      useCase({ portalId: portal.id, contentType: 'application/pdf', fileSize: 1024 }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'upload_failed',
    )
  })

  it('rejects oversized file', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext()
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    await expect(
      useCase({ portalId: portal.id, contentType: 'image/png', fileSize: 11 * 1024 * 1024 }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'upload_failed',
    )
  })
})
