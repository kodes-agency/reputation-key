import { describe, expect, it } from 'vitest'
import {
  publicationSource,
  SOURCE_HERO_ASSET_ID,
  SOURCE_LOGO_ASSET_ID,
} from '../domain/__fixtures__/publication-source'
import {
  bulgarianPrimaryConfiguration,
  immersiveConfiguration,
  IMMERSIVE_HERO_ASSET_ID,
  IMMERSIVE_LOGO_ASSET_ID,
} from '../domain/__fixtures__/immersive-configuration'
import {
  buildPortalPrintKitContext,
  presentPortalPrintKit,
  printKitContextOfLive,
} from './portal-print-kit-context'

describe('buildPortalPrintKitContext', () => {
  it('reads the portal title in each language and the property look', () => {
    const context = buildPortalPrintKitContext(publicationSource())
    expect(context.portalName).toBe('Harbor lobby')
    expect(context.primaryLocale).toBe('en')
    expect(context.locales).toEqual(['en', 'bg'])
    expect(context.titles).toEqual({
      en: 'Tell us about your visit',
      bg: 'Разкажете ни за посещението си',
    })
    expect(context.look.wordmark).toBe('HARBOR')
    expect(context.look.accentColour).toBe('#C8A45A')
    expect(context.look.hero).toEqual({
      assetId: SOURCE_HERO_ASSET_ID,
      focalX: 0.4,
      focalY: 0.6,
    })
    expect(context.look.logo).toEqual({ assetId: SOURCE_LOGO_ASSET_ID })
  })

  it('derives the field from the accent unless the background was chosen by hand', () => {
    const auto = buildPortalPrintKitContext(publicationSource())
    expect(auto.look.fieldColour).toMatch(/^#[0-9A-Fa-f]{6}$/u)
    expect(auto.look.fieldColour).not.toBe('#101010')
    const base = publicationSource().look
    if (base === null) throw new Error('fixture has a look')
    const manual = buildPortalPrintKitContext(
      publicationSource({ look: { ...base, backgroundMode: 'manual' } }),
    )
    expect(manual.look.fieldColour).toBe('#101010')
  })

  it('sets the display name where the property wrote no wordmark', () => {
    const base = publicationSource().look
    if (base === null) throw new Error('fixture has a look')
    const context = buildPortalPrintKitContext(
      publicationSource({ look: { ...base, wordmark: '  ' } }),
    )
    expect(context.look.wordmark).toBe('The Harbor Hotel')
  })

  it('has the portal name and the default look when the property has no look yet', () => {
    const context = buildPortalPrintKitContext(publicationSource({ look: null }))
    expect(context.look.wordmark).toBe('Harbor lobby')
    expect(context.look.accentColour).toBe('#EAD6A8')
    expect(context.look.hero).toBeNull()
    expect(context.look.logo).toBeNull()
  })
})

describe('a title the working copy has not written', () => {
  it('reads the primary language title, as the guest page does', () => {
    const context = buildPortalPrintKitContext(
      publicationSource({
        wording: {
          en: {
            title: 'Tell us about your visit',
            shortDescription: null,
            heroAlt: null,
            linktreeTitle: null,
          },
        },
      }),
    )
    expect(context.titles).toEqual({
      en: 'Tell us about your visit',
      bg: 'Tell us about your visit',
    })
  })

  it('leaves every language without one when the primary has none either', () => {
    const context = buildPortalPrintKitContext(publicationSource({ wording: {} }))
    expect(context.titles).toEqual({})
  })
})

describe('buildPortalPrintKitContext with the languages that are live', () => {
  it('offers only the languages the live version serves', () => {
    const context = buildPortalPrintKitContext(publicationSource(), ['en'])
    expect(context.locales).toEqual(['en'])
    expect(context.titles).toEqual({ en: 'Tell us about your visit' })
  })

  it('keeps the live order, the primary first', () => {
    const context = buildPortalPrintKitContext(publicationSource(), ['bg', 'en'])
    expect(context.locales).toEqual(['bg', 'en'])
    expect(context.primaryLocale).toBe('bg')
  })
})

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
      accentColour: '#C8A45A',
      fieldColour: '#14110F',
      hero: { assetId: IMMERSIVE_HERO_ASSET_ID, focalX: 0.4, focalY: 0.6 },
      logo: { assetId: IMMERSIVE_LOGO_ASSET_ID },
    })
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
      buildPortalPrintKitContext(publicationSource()),
    )
    expect(view.portalId).toBe('portal-1')
    expect(view.look.heroUrl).toBe(`/api/public/portal-media/${SOURCE_HERO_ASSET_ID}`)
    expect(view.look.logoUrl).toBe(`/api/public/portal-media/${SOURCE_LOGO_ASSET_ID}`)
    expect(view.look.heroFocal).toEqual({ x: 0.4, y: 0.6 })
    expect(JSON.stringify(view)).not.toContain('assetId')
  })

  it('has no image address when there is no image', () => {
    const view = presentPortalPrintKit(
      'portal-1',
      buildPortalPrintKitContext(publicationSource({ look: null })),
    )
    expect(view.look.heroUrl).toBeNull()
    expect(view.look.logoUrl).toBeNull()
    expect(view.look.heroFocal).toBeNull()
  })
})
