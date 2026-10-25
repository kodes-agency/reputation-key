import { describe, expect, it } from 'vitest'
import type { PrintFinalTextStyle } from '#/shared/domain/portal-print-final-text'
import { previewFinalFont } from './print-final-part-font'

const pt = (points: number) => `${points}pt`

const style = (over: Partial<PrintFinalTextStyle>): PrintFinalTextStyle => ({
  family: 'sans',
  weight: 400,
  italic: false,
  sizePt: 11,
  trackingEm: 0,
  leading: 1.25,
  caps: false,
  ...over,
})

describe('previewFinalFont (spec 3)', () => {
  it('asks the headline face for lining figures, so "30" does not read as "3o"', () => {
    const headline = previewFinalFont(
      style({ family: 'serif', weight: 600, sizePt: 28, trackingEm: -0.005 }),
      pt,
    )
    expect(headline.fontVariantNumeric).toBe('lining-nums')
    expect(headline.fontFamily).toBe('var(--font-guest-display)')
  })

  it('leaves the sans alone: Ysabeau Office sets lining figures already', () => {
    expect(previewFinalFont(style({}), pt).fontVariantNumeric).toBeUndefined()
  })

  it('keeps the ligatures off a tracked line, as the file does, and on an untracked one', () => {
    expect(previewFinalFont(style({ trackingEm: 0.3 }), pt).fontVariantLigatures).toBe(
      'none',
    )
    expect(previewFinalFont(style({ trackingEm: -0.005 }), pt).fontVariantLigatures).toBe(
      'normal',
    )
  })

  it('sets the size and the line pitch in points, italics as asked', () => {
    expect(
      previewFinalFont(style({ italic: true, sizePt: 9, leading: 1.25 }), pt),
    ).toMatchObject({
      fontSize: '9pt',
      lineHeight: '11.25pt',
      fontStyle: 'italic',
    })
  })
})
