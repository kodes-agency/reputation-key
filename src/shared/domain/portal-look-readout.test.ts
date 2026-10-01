import { describe, expect, it } from 'vitest'
import {
  IMMERSIVE_TEXT_COLOUR,
  MIN_FIELD_TEXT_CONTRAST,
  MIN_TEXT_CONTRAST,
  contrastRatio,
  deriveFieldColour,
  readableForegroundOn,
} from './portal-field-colour'
import { readLookContrast } from './portal-look-readout'

const CHAMPAGNE = '#EAD6A8'

describe('readLookContrast', () => {
  it('reads the board look: a champagne accent on the field derived from it', () => {
    const readout = readLookContrast({
      accent: CHAMPAGNE,
      backgroundMode: 'auto',
      backgroundColour: '#FFFFFF',
    })

    expect(readout).not.toBeNull()
    expect(readout?.field).toBe(deriveFieldColour(CHAMPAGNE))
    expect(readout?.isAcceptable).toBe(true)
    expect(readout?.buttonText.ratio).toBeCloseTo(
      contrastRatio(readableForegroundOn(CHAMPAGNE), CHAMPAGNE) as number,
      5,
    )
    expect(readout?.buttonText.isReadable).toBe(true)
    expect(readout?.smallText.ratio).toBeCloseTo(
      contrastRatio(
        IMMERSIVE_TEXT_COLOUR,
        deriveFieldColour(CHAMPAGNE) as string,
      ) as number,
      5,
    )
    expect(readout?.smallText.minimum).toBe(MIN_FIELD_TEXT_CONTRAST)
  })

  it('ignores the stored background colour while the background is automatic', () => {
    const withWhite = readLookContrast({
      accent: CHAMPAGNE,
      backgroundMode: 'auto',
      backgroundColour: '#FFFFFF',
    })
    const withBlack = readLookContrast({
      accent: CHAMPAGNE,
      backgroundMode: 'auto',
      backgroundColour: '#000000',
    })

    expect(withWhite).toEqual(withBlack)
  })

  it('uses the stored background colour as the field when it is manual', () => {
    const readout = readLookContrast({
      accent: CHAMPAGNE,
      backgroundMode: 'manual',
      backgroundColour: '#1B1410',
    })

    expect(readout?.field).toBe('#1B1410')
    expect(readout?.isAcceptable).toBe(true)
  })

  it('refuses a manual field that light text cannot be read on', () => {
    const readout = readLookContrast({
      accent: CHAMPAGNE,
      backgroundMode: 'manual',
      backgroundColour: '#E8E8E8',
    })

    expect(readout?.smallText.isReadable).toBe(false)
    expect(readout?.isAcceptable).toBe(false)
  })

  it('flags an accent that is hard to see on the field, and says the page draws the text colour instead', () => {
    const readout = readLookContrast({
      accent: '#1A1A2E',
      backgroundMode: 'auto',
      backgroundColour: '#FFFFFF',
    })

    expect(readout?.accentOnField.isReadable).toBe(false)
    expect(readout?.accentOnField.minimum).toBe(MIN_TEXT_CONTRAST)
    expect(readout?.isAcceptable).toBe(false)
  })

  it('always finds button text readable, whatever the accent', () => {
    for (const accent of ['#6366F1', '#FF0000', '#00FF00', '#777777', '#EAD6A8']) {
      const readout = readLookContrast({
        accent,
        backgroundMode: 'auto',
        backgroundColour: '#FFFFFF',
      })
      expect(readout?.buttonText.isReadable).toBe(true)
    }
  })

  it('answers null for a colour that is not #rrggbb', () => {
    expect(
      readLookContrast({
        accent: 'gold',
        backgroundMode: 'auto',
        backgroundColour: '#FFFFFF',
      }),
    ).toBeNull()
    expect(
      readLookContrast({
        accent: CHAMPAGNE,
        backgroundMode: 'manual',
        backgroundColour: 'dark',
      }),
    ).toBeNull()
  })
})
