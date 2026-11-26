import { describe, expect, it } from 'vitest'
import {
  bulgarianPrimaryConfiguration,
  immersiveConfiguration,
  IMMERSIVE_HERO_ASSET_ID,
  IMMERSIVE_LOGO_ASSET_ID,
} from '../domain/__fixtures__/immersive-configuration'
import {
  presentPortalPrintKit,
  printKitContextOfLive,
} from './portal-print-kit-context.server'

describe('printKitContextOfLive', () => {
  it('reads the languages, titles and look of the published version', () => {
    const context = printKitContextOfLive('Harbor lobby', immersiveConfiguration())
    expect(context.portalName).toBe('Harbor lobby')
    expect(context.primaryLocale).toBe('en')
    expect(context.locales).toEqual(['en', 'bg'])
    expect(context.titles).toEqual({
      en: 'Tell us about your visit',
      bg: 'Разкажете ни за посещението си',
    })
    expect(context.look).toEqual({
      wordmark: 'HARBOR',
      propertyName: 'The Harbor Hotel',
      accentColour: '#C8A45A',
      fieldColour: '#14110F',
      hero: {
        assetId: IMMERSIVE_HERO_ASSET_ID,
        width: 1600,
        height: 1000,
        focalX: 0.4,
        focalY: 0.6,
      },
      logo: { assetId: IMMERSIVE_LOGO_ASSET_ID, width: 480, height: 120 },
    })
  })

  it('reads the primary language title for a language with none written, as the guest page does', () => {
    const base = immersiveConfiguration()
    const { bg: _bg, ...withoutBulgarian } = base.localizedContent
    const context = printKitContextOfLive(
      'Bar',
      immersiveConfiguration({ localizedContent: withoutBulgarian }),
    )
    expect(context.titles).toEqual({
      en: 'Tell us about your visit',
      bg: 'Tell us about your visit',
    })
  })

  it('leaves every language without a title when the primary has none either', () => {
    const context = printKitContextOfLive(
      'Bar',
      immersiveConfiguration({ localizedContent: {} }),
    )
    expect(context.titles).toEqual({})
  })

  it('takes the primary language of the published version', () => {
    const context = printKitContextOfLive('Bar', bulgarianPrimaryConfiguration())
    expect(context.primaryLocale).toBe('bg')
    expect(context.locales).toEqual(['bg', 'en'])
  })

  it('carries the title a language copied from the primary', () => {
    const base = immersiveConfiguration()
    const bg = base.localizedContent.bg
    if (!bg) throw new Error('fixture has Bulgarian')
    const context = printKitContextOfLive(
      'Bar',
      immersiveConfiguration({
        localizedContent: {
          ...base.localizedContent,
          bg: { ...bg, title: { value: 'Tell us about your visit', fallbackFrom: 'en' } },
        },
      }),
    )
    expect(context.titles.bg).toBe('Tell us about your visit')
  })

  it('sets the display name where the published look has no wordmark', () => {
    const base = immersiveConfiguration()
    const context = printKitContextOfLive(
      'Bar',
      immersiveConfiguration({ brandProfile: { ...base.brandProfile, wordmark: null } }),
    )
    expect(context.look.wordmark).toBe('The Harbor Hotel')
  })

  it('prints the look each Portal published: two Portals of one Property print their own palette, photo and logo', () => {
    const base = immersiveConfiguration()
    const ownLook = printKitContextOfLive(
      'Spa',
      immersiveConfiguration({
        brandProfile: {
          ...base.brandProfile,
          // A Portal's own look is published as the effective values; the public name stays the Property's.
          wordmark: 'SPA',
          logo: {
            assetId: '70000000-0000-4000-8000-0000000000b2',
            width: 300,
            height: 300,
          },
          hero: {
            assetId: '70000000-0000-4000-8000-0000000000b1',
            width: 1200,
            height: 800,
            focalX: 0.2,
            focalY: 0.4,
          },
          accentColour: '#B8860B',
          fieldColour: '#201810',
          lookVersion: 4,
        },
      }),
    )
    const followsProperty = printKitContextOfLive('Reception', base)

    expect(ownLook.look).toEqual({
      wordmark: 'SPA',
      propertyName: 'The Harbor Hotel',
      accentColour: '#B8860B',
      fieldColour: '#201810',
      hero: {
        assetId: '70000000-0000-4000-8000-0000000000b1',
        width: 1200,
        height: 800,
        focalX: 0.2,
        focalY: 0.4,
      },
      logo: {
        assetId: '70000000-0000-4000-8000-0000000000b2',
        width: 300,
        height: 300,
      },
    })
    expect(followsProperty.look.accentColour).toBe('#C8A45A')
    expect(followsProperty.look.hero?.assetId).toBe(IMMERSIVE_HERO_ASSET_ID)
    expect(ownLook.look).not.toEqual(followsProperty.look)
  })

  it('has no photo and no logo when the published look has none', () => {
    const base = immersiveConfiguration()
    const context = printKitContextOfLive(
      'Bar',
      immersiveConfiguration({
        brandProfile: { ...base.brandProfile, hero: null, logo: null },
      }),
    )
    expect(context.look.hero).toBeNull()
    expect(context.look.logo).toBeNull()
  })
})

describe('presentPortalPrintKit', () => {
  it('addresses the images by their public path, never by asset id alone', () => {
    const view = presentPortalPrintKit(
      'portal-1',
      printKitContextOfLive('Harbor lobby', immersiveConfiguration()),
    )
    expect(view.portalId).toBe('portal-1')
    expect(view.look.heroUrl).toBe(`/api/public/portal-media/${IMMERSIVE_HERO_ASSET_ID}`)
    expect(view.look.logoUrl).toBe(`/api/public/portal-media/${IMMERSIVE_LOGO_ASSET_ID}`)
    expect(view.look.heroFocal).toEqual({ x: 0.4, y: 0.6 })
    expect(view.look.heroSize).toEqual({ width: 1600, height: 1000 })
    expect(JSON.stringify(view)).not.toContain('assetId')
  })

  it('has no image address when there is no image', () => {
    const view = presentPortalPrintKit(
      'portal-1',
      printKitContextOfLive('Harbor lobby', noPhotoConfiguration()),
    )
    expect(view.look.heroUrl).toBeNull()
    expect(view.look.logoUrl).toBeNull()
    expect(view.look.heroFocal).toBeNull()
    expect(view.look.heroSize).toBeNull()
  })
})

function noPhotoConfiguration() {
  const base = immersiveConfiguration()
  return immersiveConfiguration({
    brandProfile: { ...base.brandProfile, hero: null, logo: null },
  })
}
