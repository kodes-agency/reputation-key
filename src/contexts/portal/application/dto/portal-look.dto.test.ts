import { describe, expect, it } from 'vitest'
import {
  portalLookColoursInputSchema,
  portalLookIdentityInputSchema,
  portalLookPhotoInputSchema,
} from './portal-look.dto'

const TARGET = { propertyId: 'property-1', portalId: 'portal-1' }
const HERO = '30000000-0000-4000-8000-000000000003'

describe('portalLookColoursInputSchema', () => {
  it('takes the mode alone, or the mode with any of the colours', () => {
    for (const colours of [
      { mode: 'inherit' },
      { mode: 'own' },
      { mode: 'own', accentColour: '#2f855a' },
      { mode: 'own', backgroundMode: 'manual', backgroundColour: '#0B1F14' },
    ]) {
      expect(portalLookColoursInputSchema.safeParse({ ...TARGET, colours }).success).toBe(
        true,
      )
    }
  })

  it.each(['gold', '#2F855', 'not-a-colour'])('refuses %j as a colour', (colour) => {
    expect(
      portalLookColoursInputSchema.safeParse({
        ...TARGET,
        colours: { mode: 'own', accentColour: colour },
      }).success,
    ).toBe(false)
  })

  it('refuses a mode it does not know and a save with no portal', () => {
    expect(
      portalLookColoursInputSchema.safeParse({ ...TARGET, colours: { mode: 'mine' } })
        .success,
    ).toBe(false)
    expect(
      portalLookColoursInputSchema.safeParse({
        propertyId: 'property-1',
        colours: { mode: 'own' },
      }).success,
    ).toBe(false)
  })
})

describe('portalLookIdentityInputSchema', () => {
  it('takes a wordmark and a logo, either cleared with null', () => {
    expect(
      portalLookIdentityInputSchema.safeParse({
        ...TARGET,
        identity: { mode: 'own', wordmark: null, logoAssetId: null },
      }).success,
    ).toBe(true)
    expect(
      portalLookIdentityInputSchema.safeParse({
        ...TARGET,
        identity: { mode: 'own', logoAssetId: 'logo.png' },
      }).success,
    ).toBe(false)
  })
})

describe('portalLookPhotoInputSchema', () => {
  it('takes the three photo modes', () => {
    for (const photo of [
      { mode: 'inherit' },
      { mode: 'none' },
      { mode: 'own', heroAssetId: HERO, focalX: 0, focalY: 1 },
    ]) {
      expect(portalLookPhotoInputSchema.safeParse({ ...TARGET, photo }).success).toBe(
        true,
      )
    }
  })

  it('refuses an anchor outside the photo and an image that is not an upload', () => {
    expect(
      portalLookPhotoInputSchema.safeParse({
        ...TARGET,
        photo: { mode: 'own', focalX: 1.5 },
      }).success,
    ).toBe(false)
    expect(
      portalLookPhotoInputSchema.safeParse({
        ...TARGET,
        photo: { mode: 'own', heroAssetId: 'https://x.test/pool.jpg' },
      }).success,
    ).toBe(false)
  })

  it('takes one description per language, null clearing it', () => {
    expect(
      portalLookPhotoInputSchema.safeParse({
        ...TARGET,
        photo: {
          mode: 'own',
          altTexts: [
            { locale: 'en', text: 'Treatment room' },
            { locale: 'bg', text: null },
          ],
        },
      }).success,
    ).toBe(true)
    expect(
      portalLookPhotoInputSchema.safeParse({
        ...TARGET,
        photo: {
          mode: 'own',
          altTexts: [
            { locale: 'en', text: 'One' },
            { locale: 'en', text: 'Two' },
          ],
        },
      }).success,
    ).toBe(false)
  })

  it('refuses a language the catalogue does not offer', () => {
    expect(
      portalLookPhotoInputSchema.safeParse({
        ...TARGET,
        photo: { mode: 'own', altTexts: [{ locale: 'xx', text: 'Nope' }] },
      }).success,
    ).toBe(false)
  })
})
