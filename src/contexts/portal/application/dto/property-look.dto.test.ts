import { describe, expect, it } from 'vitest'
import {
  propertyDefaultLocalesInputSchema,
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
