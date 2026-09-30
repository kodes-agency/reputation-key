import { describe, expect, it } from 'vitest'
import {
  IMMERSIVE_HERO_ASSET_ID,
  IMMERSIVE_LOGO_ASSET_ID,
  IMMERSIVE_TILE_ASSET_ID,
  immersiveConfiguration,
} from './__fixtures__/immersive-snapshot'
import { immersiveAssetIds, presentImmersivePortal } from './public-portal-immersive'

const MEDIA = {
  [IMMERSIVE_HERO_ASSET_ID]: 'https://media.example.test/hero.webp',
  [IMMERSIVE_LOGO_ASSET_ID]: 'https://media.example.test/logo.webp',
  [IMMERSIVE_TILE_ASSET_ID]: 'https://media.example.test/tile.webp',
}

describe('immersiveAssetIds', () => {
  it('lists the logo, hero and tile images once each, in a stable order', () => {
    expect(immersiveAssetIds(immersiveConfiguration())).toEqual([
      IMMERSIVE_LOGO_ASSET_ID,
      IMMERSIVE_HERO_ASSET_ID,
      IMMERSIVE_TILE_ASSET_ID,
    ])
  })

  it('lists an asset used in two places once', () => {
    const base = immersiveConfiguration()
    const [menu, spa] = base.links
    if (!menu || !spa) throw new Error('fixture needs two links')

    const ids = immersiveAssetIds(
      immersiveConfiguration({
        links: [{ ...menu, imageAssetId: IMMERSIVE_HERO_ASSET_ID }, spa],
      }),
    )

    expect(ids).toEqual([
      IMMERSIVE_LOGO_ASSET_ID,
      IMMERSIVE_HERO_ASSET_ID,
      IMMERSIVE_TILE_ASSET_ID,
    ])
  })

  it('is empty for a portal with no media', () => {
    const base = immersiveConfiguration()

    expect(
      immersiveAssetIds(
        immersiveConfiguration({
          links: base.links.map((link) => ({ ...link, imageAssetId: null })),
          brandProfile: { ...base.brandProfile, logo: null, hero: null },
        }),
      ),
    ).toEqual([])
  })
})

describe('presentImmersivePortal', () => {
  const configuration = immersiveConfiguration()

  it('returns null when the snapshot has no content for the locale', () => {
    expect(
      presentImmersivePortal(configuration, 'de', configuration.links, MEDIA),
    ).toBeNull()
  })

  it('returns null when an approved link has no wording in the locale', () => {
    const [menu, spa] = configuration.links
    if (!menu || !spa) throw new Error('fixture needs two links')
    const { bg: _bg, ...englishOnly } = spa.texts

    expect(
      presentImmersivePortal(
        configuration,
        'bg',
        [menu, { ...spa, texts: englishOnly }],
        MEDIA,
      ),
    ).toBeNull()
  })

  it('maps media to URLs with its size and the hero focal point', () => {
    const presented = presentImmersivePortal(
      configuration,
      'en',
      configuration.links,
      MEDIA,
    )

    expect(presented?.immersive.brand.logo).toEqual({
      url: MEDIA[IMMERSIVE_LOGO_ASSET_ID],
      width: 480,
      height: 120,
    })
    expect(presented?.immersive.brand.hero).toEqual({
      url: MEDIA[IMMERSIVE_HERO_ASSET_ID],
      width: 1600,
      height: 1000,
      focalX: 0.4,
      focalY: 0.6,
    })
  })

  it('serves no media for an asset the caller did not allow', () => {
    const presented = presentImmersivePortal(configuration, 'en', configuration.links, {})

    expect(presented?.immersive.brand.logo).toBeNull()
    expect(presented?.immersive.brand.hero).toBeNull()
    expect(presented?.portal.heroImageUrl).toBeNull()
    expect(presented?.immersive.links.map((link) => link.imageUrl)).toEqual([null, null])
  })

  it('never serves a value inherited from Object.prototype as a media URL', () => {
    const base = immersiveConfiguration()
    const inherited = immersiveConfiguration({
      brandProfile: {
        ...base.brandProfile,
        logo: { assetId: 'constructor', width: 10, height: 10 },
        hero: { ...base.brandProfile.hero!, assetId: '__proto__' },
      },
      links: base.links.map((link) => ({ ...link, imageAssetId: 'toString' })),
    })

    const presented = presentImmersivePortal(inherited, 'en', inherited.links, {})

    expect(presented?.immersive.brand.logo).toBeNull()
    expect(presented?.immersive.brand.hero).toBeNull()
    expect(presented?.immersive.links.map((link) => link.imageUrl)).toEqual([null, null])
  })

  it('gives each approved link a zero-padded position as its legacy sort key', () => {
    const presented = presentImmersivePortal(
      configuration,
      'en',
      configuration.links,
      MEDIA,
    )

    expect(presented?.links.map((link) => link.sortKey)).toEqual(['0000', '0001'])
    expect(presented?.links.map((link) => link.url)).toEqual(
      configuration.links.map((link) => link.url),
    )
  })

  it('presents only the links it is given, in that order', () => {
    const [menu, spa] = configuration.links
    if (!menu || !spa) throw new Error('fixture needs two links')

    const presented = presentImmersivePortal(configuration, 'en', [spa], MEDIA)

    expect(presented?.immersive.links.map((link) => link.label)).toEqual(['Spa'])
    expect(presented?.links.map((link) => link.sortKey)).toEqual(['0000'])
  })
})
