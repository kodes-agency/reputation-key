import { describe, expect, it } from 'vitest'
import { fitFontSize, wrapWords } from './print-kit-text'

const byLength = (text: string) => text.length

describe('wrapWords', () => {
  it('keeps a text that fits on one line', () => {
    expect(wrapWords('Rate your visit', 20, byLength)).toEqual(['Rate your visit'])
  })

  it('breaks between words and balances two lines', () => {
    // Greedy would leave "Rate your visit now" over a stub, "please".
    expect(wrapWords('Rate your visit now please', 20, byLength)).toEqual([
      'Rate your visit',
      'now please',
    ])
  })

  it('lets a word wider than the line stand alone rather than cut it', () => {
    expect(wrapWords('Bewertungsmöglichkeit hier', 10, byLength)).toEqual([
      'Bewertungsmöglichkeit',
      'hier',
    ])
  })

  it('returns no lines for blank text', () => {
    expect(wrapWords('   ', 10, byLength)).toEqual([])
  })

  it('breaks into as many lines as it needs', () => {
    expect(wrapWords('one two three four five six', 9, byLength)).toEqual([
      'one two',
      'three',
      'four five',
      'six',
    ])
  })
})

describe('fitFontSize', () => {
  it('keeps the size when the text fits', () => {
    expect(
      fitFontSize({ size: 8, minSize: 5, maxWidth: 100, widthAt: (s) => s * 10 }),
    ).toBe(8)
  })

  it('shrinks to the size that fits', () => {
    expect(
      fitFontSize({ size: 8, minSize: 5, maxWidth: 60, widthAt: (s) => s * 10 }),
    ).toBe(6)
  })

  it('stops at the smallest legible size', () => {
    expect(
      fitFontSize({ size: 8, minSize: 5, maxWidth: 10, widthAt: (s) => s * 10 }),
    ).toBe(5)
  })
})
