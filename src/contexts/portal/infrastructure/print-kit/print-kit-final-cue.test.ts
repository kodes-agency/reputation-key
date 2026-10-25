import { describe, expect, it } from 'vitest'
import { GUEST_LOCALES, type GuestLocale } from '#/shared/domain/guest-locale'
import { PRINT_FINAL_PIECES } from '#/shared/domain/portal-print-final'
import {
  PRINT_FINAL_SCAN_CUE,
  placePrintFinalCues,
  printFinalCueLines,
  printFinalCueStyle,
  printFinalCuesFit,
} from '#/shared/domain/portal-print-final-cue'
import {
  PRINT_FINAL_LONG_ADDRESS_COUNTER,
  PRINT_FINAL_MEASURES,
  mmPt,
  ptMm,
} from '#/shared/domain/portal-print-final-measures'
import { newDocument } from './__fixtures__/print-kit-face-fixtures'
import { pdfFinalMeasurer } from './print-kit-final-face'

// The cue measured with the fonts the PDF embeds (spec 5.2, review 3): every
// language's cue keeps one line on every bar, every pair of languages keeps rule
// C (one cap height of bar each side of a line, 0.5 mm above and below), and the
// lines are centred in the bar by their ink.

const { doc, fonts } = newDocument()
const pdf = pdfFinalMeasurer(doc, fonts)

/** Every bar: each piece in each region (the Counter card's long-address tile too). */
const BARS = [
  ...(['us', 'eu'] as const).flatMap((region) =>
    PRINT_FINAL_PIECES.map((piece) => ({
      name: `${piece} ${region}`,
      tilePt: PRINT_FINAL_MEASURES[region][piece].tilePt,
      bars: PRINT_FINAL_MEASURES[region][piece].bars,
      cuePt: PRINT_FINAL_MEASURES[region][piece].cuePt,
    })),
  ),
  {
    name: 'counter long address',
    tilePt: PRINT_FINAL_LONG_ADDRESS_COUNTER.tilePt,
    bars: PRINT_FINAL_LONG_ADDRESS_COUNTER.bars,
    cuePt: PRINT_FINAL_MEASURES.us.counter.cuePt,
  },
]

const cueWidthMm = (locale: GuestLocale, cuePt: number) =>
  ptMm(pdf.advancePt(PRINT_FINAL_SCAN_CUE[locale], printFinalCueStyle(cuePt)))

describe('the cue widths, as the font sets them (spec 5.2)', () => {
  // The board's table, at 8 pt, measured in the browser; the file's fonts agree to a few tenths of a
  // millimetre, except the embedded Cyrillic file, which sets the Bulgarian cue about a millimetre wider.
  const BOARD_MM_AT_8PT: Readonly<Record<GuestLocale, number>> = {
    en: 26.8,
    es: 26.1,
    fr: 27.2,
    de: 24.2,
    it: 22.6,
    bg: 25.4,
  }

  it.each(GUEST_LOCALES.map((locale) => [locale] as const))(
    '%s: is the board’s width at 8 pt, and fits the narrowest bar’s 27.8 mm',
    (locale) => {
      const width = cueWidthMm(locale, 8)
      expect(Math.abs(width - BOARD_MM_AT_8PT[locale])).toBeLessThan(
        locale === 'bg' ? 1.1 : 0.5,
      )
      expect(width).toBeLessThanOrEqual(27.8)
    },
  )
})

describe.each(BARS.map((bar) => [bar.name, bar] as const))('%s', (_, bar) => {
  it('keeps every language’s cue on one line, measured with the font', () => {
    for (const locale of GUEST_LOCALES) {
      expect(
        printFinalCueLines([PRINT_FINAL_SCAN_CUE[locale]], bar.tilePt, bar.cuePt, pdf),
        locale,
      ).toHaveLength(1)
    }
  })

  it('keeps rule C for every pair of languages: a cap height of bar each side, 0.5 mm above and below', () => {
    const style = printFinalCueStyle(bar.cuePt)
    const cap = 0.7 * bar.cuePt
    for (const first of GUEST_LOCALES) {
      for (const second of GUEST_LOCALES.filter((l) => l !== first)) {
        const lines = [PRINT_FINAL_SCAN_CUE[first], PRINT_FINAL_SCAN_CUE[second]]
        const label = `${first} + ${second}`
        expect(printFinalCuesFit(lines, bar.tilePt, bar.cuePt, pdf), label).toBe(true)
        for (const line of lines) {
          const side = (bar.tilePt - pdf.advancePt(line, style)) / 2
          expect(side, `${label}: ${line}`).toBeGreaterThanOrEqual(cap)
        }
        const [top, bottom] = placePrintFinalCues(lines, bar.cuePt, bar.bars.twoPt, pdf)
        const above = (top ?? NaN) - pdf.ink(lines[0] ?? '', style).ascentPt
        const below =
          bar.bars.twoPt - ((bottom ?? NaN) + pdf.ink(lines[1] ?? '', style).descentPt)
        expect(above, label).toBeGreaterThanOrEqual(mmPt(0.5))
        expect(below, label).toBeGreaterThanOrEqual(mmPt(0.5))
        expect(Math.abs(above - below), `${label}: centred by ink`).toBeLessThan(0.01)
      }
    }
  })

  it('centres a lone cue by its ink, with 0.5 mm of bar above and below', () => {
    const style = printFinalCueStyle(bar.cuePt)
    for (const locale of GUEST_LOCALES) {
      const line = PRINT_FINAL_SCAN_CUE[locale]
      const [baseline] = placePrintFinalCues([line], bar.cuePt, bar.bars.onePt, pdf)
      const ink = pdf.ink(line, style)
      const above = (baseline ?? NaN) - ink.ascentPt
      const below = bar.bars.onePt - ((baseline ?? NaN) + ink.descentPt)
      expect(above, locale).toBeGreaterThanOrEqual(mmPt(0.5))
      expect(Math.abs(above - below), locale).toBeLessThan(0.01)
    }
  })
})
