import { describe, expect, it } from 'vitest'
import {
  propertyDefaultLocalesInputSchema,
  propertyHeroInputSchema,
  propertyLogoInputSchema,
  propertyLookInputSchema,
} from './property-look.dto'

const LOOK = { propertyId: 'property-1', accentColour: '#EAD6A8', backgroundMode: 'auto' }

describe('propertyLookInputSchema', () => {
  it('takes an accent, a mode and, optionally, a background and a wordmark', () => {
    expect(propertyLookInputSchema.safeParse(LOOK).success).toBe(true)
    expect(
      propertyLookInputSchema.safeParse({
        ...LOOK,
        backgroundMode: 'manual',
        backgroundColour: '#1b1410',
        wordmark: null,
      }).success,
    ).toBe(true)
  })

  it.each(['gold', '#EAD6A', '#EAD6A8FF', 'EAD6A8', ''])(
    'refuses %j as a colour',
    (colour) => {
      expect(
        propertyLookInputSchema.safeParse({ ...LOOK, accentColour: colour }).success,
      ).toBe(false)
      expect(
        propertyLookInputSchema.safeParse({ ...LOOK, backgroundColour: colour }).success,
      ).toBe(false)
    },
  )

  it('refuses a mode that is neither automatic nor manual', () => {
    expect(
      propertyLookInputSchema.safeParse({ ...LOOK, backgroundMode: 'dark' }).success,
    ).toBe(false)
  })
})

describe('propertyDefaultLocalesInputSchema', () => {
  it('keeps the order it was given', () => {
    const parsed = propertyDefaultLocalesInputSchema.parse({
      propertyId: 'property-1',
      locales: ['bg', 'en'],
    })
    expect(parsed.locales).toEqual(['bg', 'en'])
  })

  it('refuses no languages and a language that is not offered', () => {
    expect(
      propertyDefaultLocalesInputSchema.safeParse({ propertyId: 'p', locales: [] })
        .success,
    ).toBe(false)
    expect(
      propertyDefaultLocalesInputSchema.safeParse({ propertyId: 'p', locales: ['xx'] })
        .success,
    ).toBe(false)
  })
})

const ASSET = '30000000-0000-4000-8000-000000000001'

describe('propertyHeroInputSchema', () => {
  it('takes an asset with a focal point and a description per offered language', () => {
    expect(
      propertyHeroInputSchema.safeParse({
        propertyId: 'property-1',
        assetId: ASSET,
        focalX: 0.5,
        focalY: 0,
        altTexts: [
          { locale: 'en', text: 'Evening on the sea terrace' },
          { locale: 'bg', text: null },
        ],
      }).success,
    ).toBe(true)
  })

  it('takes null to remove the photograph, and nothing else', () => {
    expect(
      propertyHeroInputSchema.safeParse({ propertyId: 'property-1', assetId: null })
        .success,
    ).toBe(true)
    expect(propertyHeroInputSchema.safeParse({ propertyId: 'property-1' }).success).toBe(
      false,
    )
  })

  it.each([
    ['an id that is not a UUID', { assetId: 'asset-1' }],
    ['a focal point outside the photograph', { assetId: ASSET, focalX: 1.1 }],
    ['a negative focal point', { assetId: ASSET, focalY: -0.1 }],
    [
      'a language that is not offered',
      { assetId: ASSET, altTexts: [{ locale: 'xx', text: 'x' }] },
    ],
    [
      'a description of absurd length',
      { assetId: ASSET, altTexts: [{ locale: 'en', text: 'x'.repeat(2001) }] },
    ],
  ])('refuses %s', (_label, patch) => {
    expect(
      propertyHeroInputSchema.safeParse({ propertyId: 'property-1', ...patch }).success,
    ).toBe(false)
  })
})

describe('propertyLogoInputSchema', () => {
  it('takes an asset id or null', () => {
    expect(
      propertyLogoInputSchema.safeParse({ propertyId: 'property-1', assetId: ASSET })
        .success,
    ).toBe(true)
    expect(
      propertyLogoInputSchema.safeParse({ propertyId: 'property-1', assetId: null })
        .success,
    ).toBe(true)
    expect(
      propertyLogoInputSchema.safeParse({ propertyId: 'property-1', assetId: 'x' })
        .success,
    ).toBe(false)
  })
})
