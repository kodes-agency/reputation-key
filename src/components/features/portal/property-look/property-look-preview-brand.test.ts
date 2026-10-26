import { describe, expect, it } from 'vitest'
import type { PortalLookSources } from '#/contexts/portal/application/public-api'
import { deriveFieldColour } from '#/shared/domain/portal-field-colour'
import { previewBrandOf } from './property-look-preview-brand'
import type { LookDraft } from './property-look-rules'

const BRAND = {
  displayName: 'Avela Resort',
  wordmark: 'AVELA',
  logo: null,
  hero: { url: 'photo.jpg', width: 1600, height: 1000, focalX: 0.5, focalY: 0.4 },
  accentColour: '#2563EB',
  fieldColour: '#0B0F1A',
}

const DRAFT: LookDraft = {
  accent: '#EAD6A8',
  backgroundMode: 'auto',
  field: '#1B1410',
  wordmark: 'AVELA',
}

describe('previewBrandOf', () => {
  it('draws the draft accent on the field derived from it, before anything is saved', () => {
    const brand = previewBrandOf(BRAND, DRAFT, true)

    expect(brand.accentColour).toBe('#EAD6A8')
    expect(brand.fieldColour).toBe(deriveFieldColour('#EAD6A8'))
    expect(brand.displayName).toBe('Avela Resort')
  })

  it('draws a manual background as chosen', () => {
    expect(
      previewBrandOf(
        BRAND,
        { ...DRAFT, backgroundMode: 'manual', field: '#1b1410' },
        true,
      ).fieldColour,
    ).toBe('#1B1410')
  })

  it('draws the wordmark as typed, and none when it is emptied', () => {
    expect(previewBrandOf(BRAND, { ...DRAFT, wordmark: ' ATLAS ' }, true).wordmark).toBe(
      'ATLAS',
    )
    expect(previewBrandOf(BRAND, { ...DRAFT, wordmark: '  ' }, true).wordmark).toBeNull()
  })

  it('leaves out the photo when asked, and keeps it otherwise', () => {
    expect(previewBrandOf(BRAND, DRAFT, false).hero).toBeNull()
    expect(previewBrandOf(BRAND, DRAFT, true).hero).toEqual(BRAND.hero)
  })

  it("draws the person's own photograph and logo in place of what the server last said", () => {
    const hero = { url: 'new.jpg', width: 2400, height: 1600, focalX: 0.2, focalY: 0.7 }
    const logo = { url: 'logo.png', width: 480, height: 120 }

    const brand = previewBrandOf(BRAND, DRAFT, true, { hero, logo })

    expect(brand.hero).toEqual(hero)
    expect(brand.logo).toEqual(logo)
  })

  it('draws none for a photograph or logo that was taken off, and no photo when asked not to', () => {
    expect(previewBrandOf(BRAND, DRAFT, true, { hero: null, logo: null })).toMatchObject({
      hero: null,
      logo: null,
    })
    const hero = { url: 'new.jpg', width: 2400, height: 1600, focalX: 0.2, focalY: 0.7 }
    expect(previewBrandOf(BRAND, DRAFT, false, { hero, logo: null }).hero).toBeNull()
  })

  it('keeps the colours the page already has while the draft holds no complete colour', () => {
    const brand = previewBrandOf(
      BRAND,
      { ...DRAFT, backgroundMode: 'manual', field: '#12' },
      true,
    )

    expect(brand.accentColour).toBe('#2563EB')
    expect(brand.fieldColour).toBe('#0B0F1A')
  })
})

describe('previewBrandOf for a portal with parts of its own', () => {
  const OWN_PHOTO = { url: 'spa.jpg', width: 1200, height: 900, focalX: 0.3, focalY: 0.6 }
  const OWN_LOGO = { url: 'spa-logo.png', width: 300, height: 100 }
  const spaBrand = {
    ...BRAND,
    wordmark: 'SPA',
    logo: OWN_LOGO,
    hero: OWN_PHOTO,
    accentColour: '#7FB069',
    fieldColour: '#0E1A0B',
  }
  const follows: PortalLookSources = {
    photo: 'property',
    colours: 'property',
    identity: 'property',
  }
  const sources = (own: Partial<PortalLookSources>): PortalLookSources => ({
    ...follows,
    ...own,
  })

  it('lays the draft over every part when the portal follows them all', () => {
    expect(previewBrandOf(BRAND, DRAFT, true, undefined, follows)).toEqual(
      previewBrandOf(BRAND, DRAFT, true),
    )
  })

  it('leaves a portal’s own colours as the page read them, and still draws the rest', () => {
    const brand = previewBrandOf(
      spaBrand,
      { ...DRAFT, wordmark: 'ATLAS' },
      true,
      undefined,
      sources({ colours: 'portal' }),
    )

    expect(brand.accentColour).toBe('#7FB069')
    expect(brand.fieldColour).toBe('#0E1A0B')
    expect(brand.wordmark).toBe('ATLAS')
  })

  it('leaves a portal’s own name and logo, and the draft wordmark does not reach it', () => {
    const brand = previewBrandOf(
      spaBrand,
      { ...DRAFT, wordmark: 'ATLAS' },
      true,
      { hero: null, logo: { url: 'property-logo.png', width: 480, height: 120 } },
      sources({ identity: 'portal' }),
    )

    expect(brand.wordmark).toBe('SPA')
    expect(brand.logo).toEqual(OWN_LOGO)
    expect(brand.accentColour).toBe(DRAFT.accent)
  })

  it('keeps a portal’s own photo whatever the preview asks and whatever photo the person is choosing', () => {
    const property = {
      url: 'new.jpg',
      width: 2400,
      height: 1600,
      focalX: 0.2,
      focalY: 0.7,
    }

    for (const showPhoto of [true, false]) {
      expect(
        previewBrandOf(
          spaBrand,
          DRAFT,
          showPhoto,
          { hero: property, logo: null },
          sources({ photo: 'portal' }),
        ).hero,
      ).toEqual(OWN_PHOTO)
    }
  })

  it('keeps no photo for a portal that shows none', () => {
    expect(
      previewBrandOf(
        { ...spaBrand, hero: null },
        DRAFT,
        true,
        undefined,
        sources({ photo: 'none' }),
      ).hero,
    ).toBeNull()
  })

  it('changes nothing for a portal that owns every part, which the look no longer reaches', () => {
    const all = sources({ photo: 'portal', colours: 'portal', identity: 'portal' })

    expect(previewBrandOf(spaBrand, DRAFT, false, undefined, all)).toEqual(spaBrand)
  })
})
