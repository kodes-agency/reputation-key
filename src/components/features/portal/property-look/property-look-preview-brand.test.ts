import { describe, expect, it } from 'vitest'
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
