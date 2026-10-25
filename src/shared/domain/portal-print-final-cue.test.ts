import { describe, expect, it } from 'vitest'
import { GUEST_LOCALES } from './guest-locale'
import {
  PRINT_FINAL_SCAN_CUE,
  placePrintFinalCues,
  printFinalCueLines,
  printFinalCuesFit,
} from './portal-print-final-cue'
import { PRINT_FINAL_PIECES } from './portal-print-final'
import { PRINT_FINAL_MEASURES, inPt, mmPt } from './portal-print-final-measures'
import type { PrintFinalTextMeasurer } from './portal-print-final-text'
import { estimatedLineWidthPt } from './portal-print-kit-text-widths'

/** The preview's measures: widths from the tables (erring wide), ink as a fixed band round the baseline. */
const estimated: PrintFinalTextMeasurer = {
  advancePt: (text, style) => estimatedLineWidthPt(text, 'text', style.sizePt),
  ink: (text, style) => ({
    leftPt: 0,
    rightPt: estimatedLineWidthPt(text, 'text', style.sizePt),
    ascentPt: 0.7 * style.sizePt,
    descentPt: 0.25 * style.sizePt,
  }),
}

describe('PRINT_FINAL_SCAN_CUE (spec 5.2)', () => {
  it('has one short cue per language, the board’s', () => {
    expect(Object.keys(PRINT_FINAL_SCAN_CUE).sort()).toEqual([...GUEST_LOCALES].sort())
    expect(PRINT_FINAL_SCAN_CUE).toEqual({
      en: 'Scan with your camera',
      es: 'Escanee con la cámara',
      bg: 'Сканирайте с камера',
      it: 'Apra la fotocamera',
      fr: 'Scannez avec la caméra',
      de: 'Mit Kamera scannen',
    })
  })

  it('never says "private" in any language (rule NP)', () => {
    for (const cue of Object.values(PRINT_FINAL_SCAN_CUE)) {
      expect(cue).not.toMatch(/priv|vertraul|поверит/i)
    }
  })
})

describe('the cue on every bar, as the preview estimates it', () => {
  const bars = (['us', 'eu'] as const).flatMap((region) =>
    PRINT_FINAL_PIECES.map((piece) => ({
      region,
      piece,
      ...PRINT_FINAL_MEASURES[region][piece],
    })),
  )

  it.each(bars.map((bar) => [`${bar.piece} ${bar.region}`, bar] as const))(
    '%s: every language keeps one line, and every pair of languages keeps rule C',
    (_, bar) => {
      for (const locale of GUEST_LOCALES) {
        expect(
          printFinalCueLines(
            [PRINT_FINAL_SCAN_CUE[locale]],
            bar.tilePt,
            bar.cuePt,
            estimated,
          ),
          locale,
        ).toHaveLength(1)
        for (const other of GUEST_LOCALES.filter((l) => l !== locale)) {
          const pair = [PRINT_FINAL_SCAN_CUE[locale], PRINT_FINAL_SCAN_CUE[other]]
          expect(
            printFinalCuesFit(pair, bar.tilePt, bar.cuePt, estimated),
            `${locale} + ${other}`,
          ).toBe(true)
        }
      }
    },
  )
})

describe('the wrap fallback (spec 5.2)', () => {
  const long = 'Mit der Kamera scannen'

  it('wraps a long single cue at its middle space, and only where it would break the padding', () => {
    expect(printFinalCueLines([long], inPt(1.4), 9, estimated)).toEqual([
      'Mit der Kamera',
      'scannen',
    ])
    expect(printFinalCueLines([long], inPt(1.25), 8, estimated)).toEqual([
      'Mit der Kamera',
      'scannen',
    ])
    expect(printFinalCueLines([long], inPt(1.5), 9, estimated)).toEqual([long])
  })

  it('wraps by the measurer it is given: a narrower font keeps the cue whole', () => {
    const narrow: PrintFinalTextMeasurer = {
      ...estimated,
      advancePt: (text, style) => 0.4 * estimated.advancePt(text, style),
    }
    expect(printFinalCueLines([long], inPt(1.25), 8, narrow)).toEqual([long])
  })

  it('leaves a cue with no space whole, even where it does not fit', () => {
    expect(printFinalCueLines(['Скандинавия'], mmPt(10), 8, estimated)).toEqual([
      'Скандинавия',
    ])
    expect(printFinalCuesFit(['Скандинавия'], mmPt(10), 8, estimated)).toBe(false)
  })

  it('gives two languages one cue line each, first language on top, and never wraps one', () => {
    const pair = [long, PRINT_FINAL_SCAN_CUE.es]
    expect(printFinalCueLines(pair, inPt(1.25), 8, estimated)).toEqual(pair)
    expect(printFinalCuesFit(pair, inPt(1.25), 8, estimated)).toBe(false)
  })
})

describe('placePrintFinalCues (spec 5.2: centred by ink)', () => {
  const ink = (ascentPt: number, descentPt: number): PrintFinalTextMeasurer => ({
    advancePt: () => 10,
    ink: () => ({ leftPt: 0, rightPt: 10, ascentPt, descentPt }),
  })

  it('puts a line’s ink, not its line box, in the middle of the bar', () => {
    const [baseline] = placePrintFinalCues(['Scan'], 9, 30, ink(6, 2))
    // The ink runs from baseline - 6 to baseline + 2: its middle is the bar's middle.
    expect(baseline).toBeCloseTo(15 + 2, 6)
    expect((baseline ?? 0) - 6).toBeCloseTo(30 - ((baseline ?? 0) + 2), 6)
  })

  it('centres two lines as one block by the first line’s top and the last line’s bottom', () => {
    const pitch = 9 * 1.12 + mmPt(0.3)
    const [first, second] = placePrintFinalCues(['Scan', 'Escanee'], 9, 40, ink(6, 2))
    expect(second).toBeCloseTo((first ?? 0) + pitch, 6)
    const top = (first ?? 0) - 6
    const bottom = (second ?? 0) + 2
    expect(top).toBeCloseTo(40 - bottom, 6)
  })

  it('moves the block up when the lower line has a descender', () => {
    const flat = placePrintFinalCues(['Scan', 'Apra'], 9, 40, ink(6, 0))
    const deep = placePrintFinalCues(['Scan', 'Apra'], 9, 40, ink(6, 2))
    expect((deep[0] ?? 0) - (flat[0] ?? 0)).toBeCloseTo(-1, 6)
  })
})
