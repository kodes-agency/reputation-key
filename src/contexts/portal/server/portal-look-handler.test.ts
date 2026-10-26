// Portal context — a Portal's own look server functions (handler invocation).
// The chain under test: the Property's execution policy and the write
// capability are asked first, the use case runs as the resolved actor, and a
// Portal error (the switch being off included) leaves as a tagged,
// status-carrying one.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { portalError } from '../domain/errors'

const mocks = vi.hoisted(() => ({
  savePortalLookColours: vi.fn(),
  savePortalLookIdentity: vi.fn(),
  savePortalLookPhoto: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
  getExecutionPolicy: vi.fn(),
}))
vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({
    portalPublicApi: {
      management: {
        savePortalLookColours: mocks.savePortalLookColours,
        savePortalLookIdentity: mocks.savePortalLookIdentity,
        savePortalLookPhoto: mocks.savePortalLookPhoto,
      },
    },
  })),
}))
vi.mock('./portals', async (importActual) => ({
  portalErrorStatus: (await importActual<typeof import('./portals')>()).portalErrorStatus,
}))

import {
  savePortalLookColours,
  savePortalLookIdentity,
  savePortalLookPhoto,
} from './portal-look'

const ACTOR = {
  userId: 'admin-1',
  organizationId: 'org-1',
  role: 'AccountAdmin',
} as const

const TARGET = { propertyId: 'property-1', portalId: 'portal-1' }
const HERO = '30000000-0000-4000-8000-000000000003'
const SAVED = {
  portalId: 'portal-1',
  sources: { photo: 'portal', colours: 'property', identity: 'property' },
  lookVersion: 5,
  changed: true,
}

const expectPolicyAskedFirst = (useCase: ReturnType<typeof vi.fn>) => {
  expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith(
    expect.objectContaining({
      actor: ACTOR,
      action: 'portal.update',
      capability: 'portal.write',
      propertyId: 'property-1',
    }),
  )
  expect(mocks.requireExecutionAllowed.mock.invocationCallOrder[0]).toBeLessThan(
    useCase.mock.invocationCallOrder[0]!,
  )
}

describe('a portal’s own look server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('asks the Property policy for portal.write before saving the colours', async () => {
    mocks.savePortalLookColours.mockResolvedValue(SAVED)
    const data = { ...TARGET, colours: { mode: 'own' as const, accentColour: '#2F855A' } }

    await withStartContext(() => savePortalLookColours({ data }))

    expectPolicyAskedFirst(mocks.savePortalLookColours)
    expect(mocks.savePortalLookColours).toHaveBeenCalledWith(data, ACTOR)
  })

  it('asks the same policy before saving the name and logo', async () => {
    mocks.savePortalLookIdentity.mockResolvedValue(SAVED)
    const data = { ...TARGET, identity: { mode: 'inherit' as const } }

    await withStartContext(() => savePortalLookIdentity({ data }))

    expectPolicyAskedFirst(mocks.savePortalLookIdentity)
    expect(mocks.savePortalLookIdentity).toHaveBeenCalledWith(data, ACTOR)
  })

  it('asks for portal.write, not portal.upload, before pointing the portal at a photo', async () => {
    mocks.savePortalLookPhoto.mockResolvedValue(SAVED)
    const data = {
      ...TARGET,
      photo: {
        mode: 'own' as const,
        heroAssetId: HERO,
        focalX: 0.5,
        focalY: 0.4,
        altTexts: [{ locale: 'en' as const, text: 'Treatment room' }],
      },
    }

    await withStartContext(() => savePortalLookPhoto({ data }))

    expectPolicyAskedFirst(mocks.savePortalLookPhoto)
    expect(mocks.savePortalLookPhoto).toHaveBeenCalledWith(data, ACTOR)
  })

  it('carries the switch being off out as a tagged 409', async () => {
    mocks.savePortalLookPhoto.mockRejectedValue(
      portalError('feature_unavailable', 'A portal cannot have its own look yet'),
    )

    await expect(
      withStartContext(() =>
        savePortalLookPhoto({ data: { ...TARGET, photo: { mode: 'none' } } }),
      ),
    ).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'feature_unavailable',
      status: 409,
    })
  })

  it('stops before the use case when the Property policy refuses', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(
      new ServerFunctionError(
        'AuthError',
        'Authorization denied: property_disabled',
        'property_disabled',
        403,
      ),
    )

    await expect(
      withStartContext(() =>
        savePortalLookColours({ data: { ...TARGET, colours: { mode: 'inherit' } } }),
      ),
    ).rejects.toMatchObject({ _tag: 'AuthError', code: 'property_disabled', status: 403 })
    expect(mocks.savePortalLookColours).not.toHaveBeenCalled()
  })
})
