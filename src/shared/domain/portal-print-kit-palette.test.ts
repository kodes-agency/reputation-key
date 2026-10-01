import { describe, expect, it } from 'vitest'
import { IMMERSIVE_TEXT_COLOUR } from './portal-field-colour'
import { printKitPalette } from './portal-print-kit-palette'

describe('printKitPalette', () => {
  it('sets the kicker in the accent when it reads on the field', () => {
    const palette = printKitPalette('#EAD6A8', '#15110D')
    expect(palette.field).toBe('#15110D')
    expect(palette.kicker).toBe('#EAD6A8')
  })

  it('sets the kicker in the page text colour when the accent would not read', () => {
    expect(printKitPalette('#201A12', '#15110D').kicker).toBe(IMMERSIVE_TEXT_COLOUR)
  })

  it('derives the washes from the accent, as the guest backdrop does', () => {
    const palette = printKitPalette('#EAD6A8', '#15110D')
    expect(palette.warm).toMatch(/^#[0-9A-F]{6}$/u)
    expect(palette.cool).toMatch(/^#[0-9A-F]{6}$/u)
  })

  it('keeps the field and the page text for a colour it cannot read', () => {
    const palette = printKitPalette('red', 'blue')
    expect(palette.kicker).toBe(IMMERSIVE_TEXT_COLOUR)
    expect(palette.warm).toBe(palette.field)
    expect(palette.cool).toBe(palette.field)
  })

  it('always prints the code in near-black on warm paper', () => {
    const palette = printKitPalette('#EAD6A8', '#15110D')
    expect(palette.plateInk).toBe('#121614')
    expect(palette.platePaper).toBe('#F6F1E6')
  })
})
