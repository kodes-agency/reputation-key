import { describe, expect, it } from 'vitest'
import { contrastRatio, readableForegroundOn } from './portal-contrast'

describe('contrastRatio', () => {
  it('is 21 for black on white, and symmetric', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
  })

  it('is 1 for a colour against itself', () => {
    expect(contrastRatio('#6366F1', '#6366f1')).toBeCloseTo(1, 5)
  })

  it('refuses to guess for a value it cannot parse', () => {
    expect(contrastRatio('rebeccapurple', '#ffffff')).toBe(1)
  })
})

describe('readableForegroundOn', () => {
  it('switches to dark text on the light brand that failed the a11y gate', () => {
    // The Dark palette preset. White text on it measured 1.99:1.
    expect(readableForegroundOn('#a5b4fc')).toBe('#000000')
  })

  it('turns the default brand indigo dark too, because white never cleared AA', () => {
    // 4.47:1 with white is BELOW the 4.5 threshold — the default portal shipped
    // a CTA no standard calls readable. Black reaches 4.70.
    expect(contrastRatio('#6366F1', '#ffffff')).toBeLessThan(4.5)
    expect(readableForegroundOn('#6366F1')).toBe('#000000')
  })

  it('clears AA on every brand colour the product ships', () => {
    for (const brand of ['#6366F1', '#a5b4fc']) {
      expect(
        contrastRatio(brand, readableForegroundOn(brand)),
        brand,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('accepts the three-digit form', () => {
    expect(readableForegroundOn('#fff')).toBe('#000000')
    expect(readableForegroundOn('#000')).toBe('#ffffff')
  })

  it('keeps the previous answer for a colour it cannot parse', () => {
    expect(readableForegroundOn('var(--something)')).toBe('#ffffff')
  })
})
