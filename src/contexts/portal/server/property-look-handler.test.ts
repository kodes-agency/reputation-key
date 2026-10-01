// Portal context — Property look server functions (handler invocation).
// The chain under test: the Property's execution policy
// and the write capability are asked first, the use case runs as the resolved
// actor, and a Portal error leaves as a tagged, status-carrying one.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { portalError } from '../domain/errors'

const mocks = vi.hoisted(() => ({
  savePropertyLook: vi.fn(),
  savePropertyHero: vi.fn(),
  savePropertyLogo: vi.fn(),
  savePropertyDefaultGuestLocales: vi.fn(),
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
        savePropertyLook: mocks.savePropertyLook,
        savePropertyHero: mocks.savePropertyHero,
        savePropertyLogo: mocks.savePropertyLogo,
        savePropertyDefaultGuestLocales: mocks.savePropertyDefaultGuestLocales,
      },
    },
  })),
}))
vi.mock('./portals', async (importActual) => ({
  portalErrorStatus: (await importActual<typeof import('./portals')>()).portalErrorStatus,
}))

import {
  savePropertyDefaultGuestLocales,
  savePropertyHero,
  savePropertyLogo,
  savePropertyLook,
} from './property-look'

const ACTOR = {
  userId: 'admin-1',
  organizationId: 'org-1',
  role: 'AccountAdmin',
} as const

describe('Property look server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('asks the Property policy for portal.write before saving the look', async () => {
    mocks.savePropertyLook.mockResolvedValue({ lookVersion: 3 })
    const data = {
      propertyId: 'property-1',
      accentColour: '#EAD6A8',
      backgroundMode: 'auto' as const,
    }

    await withStartContext(() => savePropertyLook({ data }))

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: ACTOR,
        action: 'portal.update',
        capability: 'portal.write',
        propertyId: 'property-1',
      }),
    )
    expect(mocks.savePropertyLook).toHaveBeenCalledWith(data, ACTOR)
    expect(mocks.requireExecutionAllowed.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.savePropertyLook.mock.invocationCallOrder[0]!,
    )
  })

  it('carries a refused look out as a tagged Portal error', async () => {
    mocks.savePropertyLook.mockRejectedValue(
      portalError('invalid_theme', 'Page text cannot be read on this background'),
    )

    await expect(
      withStartContext(() =>
        savePropertyLook({
          data: {
            propertyId: 'property-1',
            accentColour: '#EAD6A8',
            backgroundMode: 'manual',
            backgroundColour: '#E8E8E8',
          },
        }),
      ),
    ).rejects.toMatchObject({ _tag: 'PortalError', code: 'invalid_theme' })
  })

  it('saves the default languages in the order given', async () => {
    mocks.savePropertyDefaultGuestLocales.mockResolvedValue({})

    await withStartContext(() =>
      savePropertyDefaultGuestLocales({
        data: { propertyId: 'property-1', locales: ['bg', 'en'] },
      }),
    )

    expect(mocks.savePropertyDefaultGuestLocales).toHaveBeenCalledWith(
      { propertyId: 'property-1', locales: ['bg', 'en'] },
      ACTOR,
    )
  })

  it('stops before the use case when the Property policy refuses', async () => {
    // What `requireExecutionAllowed` throws on a denial: a tagged 403 whose code
    // is the policy's reason, never an untagged 500.
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
        savePropertyDefaultGuestLocales({
          data: { propertyId: 'property-1', locales: ['en'] },
        }),
      ),
    ).rejects.toMatchObject({
      _tag: 'AuthError',
      code: 'property_disabled',
      status: 403,
    })
    expect(mocks.savePropertyDefaultGuestLocales).not.toHaveBeenCalled()
  })

  it('asks the Property policy for portal.write, not portal.upload, before putting a photograph on the look', async () => {
    mocks.savePropertyHero.mockResolvedValue({ media: { hero: null, logo: null } })
    const data = {
      propertyId: 'property-1',
      assetId: '30000000-0000-4000-8000-000000000001',
      focalX: 0.5,
      focalY: 0.42,
      altTexts: [{ locale: 'en' as const, text: 'Evening on the sea terrace' }],
    }

    await withStartContext(() => savePropertyHero({ data }))

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: ACTOR,
        action: 'portal.update',
        capability: 'portal.write',
        propertyId: 'property-1',
      }),
    )
    expect(mocks.savePropertyHero).toHaveBeenCalledWith(data, ACTOR)
    expect(mocks.requireExecutionAllowed.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.savePropertyHero.mock.invocationCallOrder[0]!,
    )
  })

  it('carries an image refusal out as a tagged Portal error', async () => {
    mocks.savePropertyLogo.mockRejectedValue(
      portalError('media_not_found', 'image not found for this Property'),
    )

    await expect(
      withStartContext(() =>
        savePropertyLogo({
          data: {
            propertyId: 'property-1',
            assetId: '30000000-0000-4000-8000-000000000002',
          },
        }),
      ),
    ).rejects.toMatchObject({ _tag: 'PortalError', code: 'media_not_found' })
  })

  it('takes the logo off with null through the same policy', async () => {
    mocks.savePropertyLogo.mockResolvedValue({ media: { hero: null, logo: null } })

    await withStartContext(() =>
      savePropertyLogo({ data: { propertyId: 'property-1', assetId: null } }),
    )

    expect(mocks.savePropertyLogo).toHaveBeenCalledWith(
      { propertyId: 'property-1', assetId: null },
      ACTOR,
    )
  })
})
