import { describe, expect, it } from 'vitest'
import { fitFontSize, fitLines, wrapWords } from './portal-print-kit-text'

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

describe('fitLines', () => {
  /** A character is half its size wide, so a line of n characters is n * size / 2. */
  const widthAt = (text: string, size: number) => (text.length * size) / 2
  const widest = (lines: readonly string[], size: number) =>
    Math.max(...lines.map((line) => widthAt(line, size)))
  const base = { size: 12, minSize: 8, maxLines: 2, maxWidth: 100, widthAt }

  it('keeps one line at the full size when it fits', () => {
    expect(fitLines({ ...base, text: 'HARBOR' })).toEqual({
      lines: ['HARBOR'],
      size: 12,
    })
  })

  it('shrinks one line before it wraps, down to the smallest size', () => {
    const text = 'GRAND HOTEL EUROPE AND'
    const fitted = fitLines({ ...base, text })
    expect(fitted.lines).toEqual([text])
    expect(fitted.size).toBeLessThan(12)
    expect(fitted.size).toBeGreaterThanOrEqual(8)
    expect(widest(fitted.lines, fitted.size)).toBeLessThanOrEqual(100)
  })

  it('wraps to two balanced lines when one line would be smaller than the floor', () => {
    const text = 'Kempinski Hotel Grand Arena Bansko Palace'
    const fitted = fitLines({ ...base, text })
    expect(fitted.lines).toHaveLength(2)
    expect(fitted.lines.join(' ')).toBe(text)
    expect(widest(fitted.lines, fitted.size)).toBeLessThanOrEqual(100)
    // Two lines are set larger than the single line that would not have fitted.
    expect(fitted.size).toBeGreaterThan(8)
  })

  it('shrinks below the floor rather than run past the width, in the lines allowed', () => {
    const text = Array.from({ length: 10 }, (_, i) => `word${i}x`).join(' ')
    const fitted = fitLines({ ...base, text })
    expect(fitted.lines.length).toBeLessThanOrEqual(2)
    expect(fitted.size).toBeLessThan(8)
    expect(widest(fitted.lines, fitted.size)).toBeLessThanOrEqual(100)
  })

  it('shrinks a single word wider than the line, since it cannot be broken', () => {
    const text = 'Supercalifragilisticexpialidocious-ok'
    const fitted = fitLines({ ...base, text })
    expect(fitted.lines).toEqual([text])
    expect(widest(fitted.lines, fitted.size)).toBeLessThanOrEqual(100)
  })

  it('has no lines for blank text', () => {
    expect(fitLines({ ...base, text: '  ' }).lines).toEqual([])
  })
})
