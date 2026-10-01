// Portal context — the upload endpoint as the running app wires it: the
// `portal.upload` capability is asked for through the ExecutionPolicy seam, with
// the permission the purpose needs, and a refusal there stops everything.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { buildTestAuthContext } from '#/shared/testing/fixtures'

const APP = 'https://app.example.test'
const PROPERTY = 'a0000000-0000-0000-0000-000000000001'

const mocks = vi.hoisted(() => ({
  requireExecutionAllowed: vi.fn(),
  resolveTenantContext: vi.fn(),
  ingestPortalImage: vi.fn(),
  rateCheck: vi.fn(),
}))

vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
  getExecutionPolicy: vi.fn(),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/config/env', () => ({ getEnv: () => ({ BETTER_AUTH_URL: APP }) }))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    rateLimiter: { check: mocks.rateCheck },
    clock: () => new Date('2026-10-01T12:00:00Z'),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    portalPublicApi: { management: { ingestPortalImage: mocks.ingestPortalImage } },
  }),
}))

import { handlePortalMediaUpload } from './portal-media-upload'

const post = (purpose: string) =>
  new Request(
    `${APP}/api/portal-media?propertyId=${PROPERTY}&purpose=${purpose}&rightsConfirmed=true`,
    {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg', 'sec-fetch-site': 'same-origin' },
      body: Uint8Array.from([0xff, 0xd8, 0xff]),
    },
  )

beforeEach(() => {
  vi.resetAllMocks()
  mocks.resolveTenantContext.mockResolvedValue(
    buildTestAuthContext({ role: 'AccountAdmin' }),
  )
  mocks.rateCheck.mockResolvedValue({
    allowed: true,
    remaining: 1,
    resetAt: new Date(),
    backendStatus: 'available',
  })
  mocks.ingestPortalImage.mockResolvedValue({ assetId: 'x', purpose: 'hero' })
})

describe('handlePortalMediaUpload', () => {
  it.each([
    ['hero', 'portal.admin'],
    ['logo', 'portal.admin'],
    ['link_image', 'portal.update'],
  ])('asks portal.upload for a %s with the %s permission', async (purpose, action) => {
    await handlePortalMediaUpload(post(purpose))
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith(
      expect.objectContaining({
        action,
        capability: 'portal.upload',
        propertyId: PROPERTY,
      }),
    )
    expect(mocks.ingestPortalImage).toHaveBeenCalledTimes(1)
  })

  it('stops at a capability that is blocked, before the rate allowance and the ingest', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(
      new ServerFunctionError(
        'AuthError',
        'Authorization denied: capability_safety_blocked',
        'capability_safety_blocked',
        403,
      ),
    )
    const response = await handlePortalMediaUpload(post('hero'))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'capability_safety_blocked' })
    expect(mocks.rateCheck).not.toHaveBeenCalled()
    expect(mocks.ingestPortalImage).not.toHaveBeenCalled()
  })
})
