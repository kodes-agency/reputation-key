import { describe, expect, it } from 'vitest'
import {
  setPrintFinalText,
  type PrintFinalTextMeasurer,
  type PrintFinalTextStyle,
} from './portal-print-final-text'

// A measure a test can reason about: every character advances half an em, and
// its ink starts 0.05 em in, rises 0.7 em and falls 0.2 em.
const measurer: PrintFinalTextMeasurer = {
  advancePt: (text, style) =>
    style.sizePt * (text.length * 0.5 + (text.length - 1) * style.trackingEm),
  ink: (text, style) => ({
    leftPt: 0.05 * style.sizePt,
    rightPt: style.sizePt * (text.length * 0.5 - 0.05),
    ascentPt: 0.7 * style.sizePt,
    descentPt: 0.2 * style.sizePt,
  }),
}

const style = (over: Partial<PrintFinalTextStyle> = {}): PrintFinalTextStyle => ({
  family: 'serif',
  weight: 600,
  italic: false,
  sizePt: 10,
  trackingEm: 0,
  leading: 1.2,
  caps: false,
  ...over,
})

describe('setPrintFinalText', () => {
  it('measures one line by its ink and puts its baseline under the ascent', () => {
    const set = setPrintFinalText('Rate', style(), 100, 'centre', measurer)
    expect(set?.lines).toEqual([{ text: 'Rate', originPt: -0.5, baselinePt: 7 }])
    expect(set?.widthPt).toBeCloseTo(19)
    expect(set?.heightPt).toBeCloseTo(9)
  })

  it('breaks into balanced lines one pitch apart, each centred by its advance', () => {
    // "Rate your" is 45 pt, "visit" 25 pt: the column takes 2 lines.
    const set = setPrintFinalText('Rate your visit', style(), 60, 'centre', measurer)
    expect(set?.lines.map((line) => line.text)).toEqual(['Rate your', 'visit'])
    const [first, second] = set?.lines ?? []
    expect((second?.baselinePt ?? 0) - (first?.baselinePt ?? 0)).toBeCloseTo(12)
    // The wider line sets the box; the shorter is centred 10 pt in from it.
    expect(first?.originPt).toBeCloseTo(-0.5)
    expect(second?.originPt).toBeCloseTo(9.5)
    expect(set?.heightPt).toBeCloseTo(12 + 9)
  })

  it('sets every line from the column’s left edge on a wide face', () => {
    const set = setPrintFinalText('Rate your visit', style(), 60, 'left', measurer)
    expect(set?.lines.map((line) => line.originPt)).toEqual([-0.5, -0.5])
  })

  it('sets a caps style in capitals, and counts the trailing tracking when it breaks', () => {
    const tracked = style({ caps: true, trackingEm: 0.1 })
    // "AB CD" is 29 pt with its tracking, 30 pt with the trailing one: a 29.5 pt column breaks it.
    const set = setPrintFinalText('ab cd', tracked, 29.5, 'centre', measurer)
    expect(set?.lines.map((line) => line.text)).toEqual(['AB', 'CD'])
  })

  it('sets nothing for empty words', () => {
    expect(setPrintFinalText('  ', style(), 60, 'centre', measurer)).toBeNull()
  })
})
