// Portal context — the photograph and logo of a Property's look as a reader
// shows them: only an asset that is the right purpose, of this Property and
// still servable, with its address on the app's own origin.

import { describe, expect, it } from 'vitest'
import { organizationId, portalMediaAssetId, propertyId } from '#/shared/domain/ids'
import { createInMemoryPortalMediaAssetRepo } from '#/shared/testing/in-memory-portal-media-asset-repo'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import { resolvePropertyLookMedia } from './property-look-media'

const ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const PROPERTY = propertyId('a0000000-0000-0000-0000-000000000001')
const HERO_ID = '30000000-0000-4000-8000-000000000001'
const LOGO_ID = '30000000-0000-4000-8000-000000000002'

const hero = (overrides = {}) =>
  buildTestPortalMediaAsset({
    id: portalMediaAssetId(HERO_ID),
    purpose: 'hero',
    width: 2400,
    height: 1600,
    ...overrides,
  })
const logo = (overrides = {}) =>
  buildTestPortalMediaAsset({
    id: portalMediaAssetId(LOGO_ID),
    purpose: 'logo',
    width: 480,
    height: 120,
    ...overrides,
  })

const profile = {
  heroAssetId: HERO_ID,
  heroFocalX: 0.5,
  heroFocalY: 0.42,
  logoAssetId: LOGO_ID,
}

const resolve = (
  assets: Parameters<ReturnType<typeof createInMemoryPortalMediaAssetRepo>['seed']>[0],
  of: Parameters<typeof resolvePropertyLookMedia>[3] = profile,
) => {
  const mediaRepo = createInMemoryPortalMediaAssetRepo()
  mediaRepo.seed(assets)
  return resolvePropertyLookMedia({ mediaRepo }, ORG, PROPERTY, of)
}

describe('resolvePropertyLookMedia', () => {
  it('gives the photograph its size and focal point and the logo its size, both on the media route', async () => {
    const media = await resolve([hero(), logo()])

    expect(media).toEqual({
      hero: {
        assetId: HERO_ID,
        url: `/api/public/portal-media/${HERO_ID}`,
        width: 2400,
        height: 1600,
        focalX: 0.5,
        focalY: 0.42,
      },
      logo: {
        assetId: LOGO_ID,
        url: `/api/public/portal-media/${LOGO_ID}`,
        width: 480,
        height: 120,
      },
    })
  })

  it('has nothing for a profile that names no media, or for no profile', async () => {
    const none = {
      heroAssetId: null,
      heroFocalX: null,
      heroFocalY: null,
      logoAssetId: null,
    }
    expect(await resolve([hero(), logo()], none)).toEqual({ hero: null, logo: null })
    expect(await resolve([hero(), logo()], null)).toEqual({ hero: null, logo: null })
  })

  it('leaves out an image that was taken down, so the look reads as having none', async () => {
    const media = await resolve([hero({ status: 'taken_down' }), logo()])

    expect(media.hero).toBeNull()
    expect(media.logo).not.toBeNull()
  })

  it('leaves out an image of another Property, of another purpose or that is missing', async () => {
    const otherProperty = propertyId('a0000000-0000-0000-0000-000000000009')
    expect((await resolve([hero({ propertyId: otherProperty }), logo()])).hero).toBeNull()
    expect((await resolve([hero({ purpose: 'link_image' }), logo()])).hero).toBeNull()
    expect((await resolve([hero()])).logo).toBeNull()
  })

  it('does not draw a photograph that has no focal point', async () => {
    const media = await resolve([hero(), logo()], {
      ...profile,
      heroFocalX: null,
      heroFocalY: null,
    })

    expect(media.hero).toBeNull()
  })
})
