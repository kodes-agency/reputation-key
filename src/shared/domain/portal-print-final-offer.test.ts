import { describe, expect, it } from 'vitest'
import {
  PRINT_FINAL_MODULE_MIN_MM,
  choosePrintFinalTile,
  printFinalCodeBlock,
  printFinalCueLines,
  printFinalCuesFit,
  printFinalModuleMm,
} from './portal-print-final-code'
import { inPt, mmPt, ptMm } from './portal-print-final-measures'
import {
  PRINT_FINAL_MAX_QUANTITY,
  PRINT_FINAL_PER_SHEET,
  printFinalChoiceTile,
  printFinalPieceCount,
  printFinalPieceOffers,
  printFinalSheetCount,
  type PrintFinalChoice,
  type PrintFinalCodeFacts,
} from './portal-print-final-offer'

/** Modules along one side, quiet zone not included: version 3, 4 and 9. */
const V3 = 29
const V4 = 33
const V9 = 53
const SHORT: PrintFinalCodeFacts = { address: 'short', symbolModules: V3 }
const LOWERCASE: PrintFinalCodeFacts = { address: 'short', symbolModules: V4 }
const LONG: PrintFinalCodeFacts = { address: 'long', symbolModules: V9 }
const choice = (over: Partial<PrintFinalChoice> = {}): PrintFinalChoice => ({
  piece: 'counter',
  orientation: 'upright',
  look: 'paper',
  paper: 'letter',
  printer: 'my_printer',
  quantity: 10,
  languageCount: 1,
  ...over,
})
const refusalOf = (
  over: Partial<PrintFinalChoice>,
  code: PrintFinalCodeFacts = SHORT,
) => {
  const tile = printFinalChoiceTile(choice(over), code)
  return tile.isOk() ? null : tile.error.code
}

describe('the module rule (spec 9)', () => {
  it('prints every piece on the short address with modules of 0.85 mm or more', () => {
    const modules = (['counter', 'tent', 'small'] as const).map(
      (piece) =>
        choosePrintFinalTile({
          piece,
          orientation: 'wide',
          region: 'us',
          address: 'short',
          symbolModules: V3,
        })._unsafeUnwrap().moduleMm,
    )
    expect(modules.map((m) => Number(m.toFixed(2)))).toEqual([1.03, 0.96, 0.86])
    expect(Math.min(...modules)).toBeGreaterThanOrEqual(PRINT_FINAL_MODULE_MIN_MM)
  })

  it('counts the quiet zone in the module', () => {
    expect(printFinalModuleMm(inPt(1.5), V3)).toBeCloseTo(38.1 / 37, 10)
  })

  it('prints only the Counter card on the long address, on its 2.1 in tile', () => {
    const counter = choosePrintFinalTile({
      piece: 'counter',
      orientation: 'upright',
      region: 'us',
      address: 'long',
      symbolModules: V9,
    })
    expect(counter._unsafeUnwrap().tilePt).toBe(inPt(2.1))
    expect(Number(counter._unsafeUnwrap().moduleMm.toFixed(2))).toBe(0.87)
    expect(refusalOf({ piece: 'tent' }, LONG)).toBe('needs_short_code')
    expect(refusalOf({ piece: 'small' }, LONG)).toBe('needs_short_code')
    expect(refusalOf({ piece: 'counter', paper: 'a4' }, LONG)).toBeNull()
  })

  it('refuses the Small card on the lower-case fallback, in both regions', () => {
    expect(refusalOf({ piece: 'small' }, LOWERCASE)).toBe('address_host_too_long')
    expect(refusalOf({ piece: 'small', paper: 'a4' }, LOWERCASE)).toBe(
      'address_host_too_long',
    )
    expect(refusalOf({ piece: 'tent' }, LOWERCASE)).toBeNull()
    expect(refusalOf({ piece: 'counter' }, LOWERCASE)).toBeNull()
  })

  it('steps a tile up one rung, except the wide Small card, which has no room', () => {
    const tent = choosePrintFinalTile({
      piece: 'tent',
      orientation: 'wide',
      region: 'us',
      address: 'short',
      symbolModules: V3,
      rung: 'step_up',
    })
    expect(tent._unsafeUnwrap().tilePt).toBe(inPt(1.5))
    expect(
      refusalOf({ piece: 'small', orientation: 'wide' }, { ...SHORT, rung: 'step_up' }),
    ).toBe('tile_does_not_fit')
    expect(
      refusalOf(
        { piece: 'small', orientation: 'upright' },
        { ...SHORT, rung: 'step_up' },
      ),
    ).toBeNull()
  })
})

describe('the code block (spec 5.2)', () => {
  it('wraps a long single cue at its middle space, and only where it would break the padding', () => {
    expect(printFinalCueLines(['Mit der Kamera scannen'], inPt(1.4), 9)).toEqual([
      'Mit der Kamera',
      'scannen',
    ])
    expect(printFinalCueLines(['Mit der Kamera scannen'], inPt(1.25), 8)).toEqual([
      'Mit der Kamera',
      'scannen',
    ])
    expect(printFinalCueLines(['Mit der Kamera scannen'], inPt(1.5), 9)).toEqual([
      'Mit der Kamera scannen',
    ])
    expect(printFinalCueLines(['Scan with your camera'], inPt(1.25), 8)).toEqual([
      'Scan with your camera',
    ])
  })

  it('wraps the cues whose letters are wider than their count, as the font sets them', () => {
    // Bulgarian on the tent: 33.6 mm of cue in a 35.6 mm tile leaves under a cap height each side.
    expect(printFinalCueLines(['Сканирайте с камерата'], inPt(1.4), 9)).toEqual([
      'Сканирайте',
      'с камерата',
    ])
    // German in Europe: the 36 mm tent tile and the 32 mm Small tile.
    expect(printFinalCueLines(['Mit der Kamera scannen'], mmPt(36), 9)).toHaveLength(2)
    expect(printFinalCueLines(['Mit der Kamera scannen'], mmPt(32), 8)).toHaveLength(2)
  })

  it('gives two languages one cue line each, first language on top', () => {
    expect(
      printFinalCueLines(
        ['Scan with your camera', 'Escanee con la cámara'],
        inPt(1.25),
        8,
      ),
    ).toHaveLength(2)
  })

  it('says whether a pair of cues keeps its padding: English and Spanish do on every piece, French beside English does not on a tent or a Small card', () => {
    const en = 'Scan with your camera'
    const es = 'Escanee con la cámara'
    const fr = 'Scannez avec l’appareil photo'
    expect(printFinalCuesFit([en, es], inPt(1.5), 9)).toBe(true)
    expect(printFinalCuesFit([en, es], inPt(1.4), 9)).toBe(true)
    expect(printFinalCuesFit([en, es], inPt(1.25), 8)).toBe(true)
    expect(printFinalCuesFit([en, es], mmPt(32), 8)).toBe(true)
    expect(printFinalCuesFit([en, fr], inPt(1.4), 9)).toBe(false)
    expect(printFinalCuesFit([en, fr], inPt(1.25), 8)).toBe(false)
  })

  it('draws the Paper outline outside the cream square and the bar', () => {
    const tile = { tilePt: inPt(1.5), bars: { onePt: inPt(0.36), twoPt: inPt(0.46) } }
    const paper = printFinalCodeBlock({ look: 'paper' }, tile, 1)
    expect(ptMm(paper.widthPt)).toBeCloseTo(38.1 + 0.7, 6)
    expect(ptMm(paper.heightPt)).toBeCloseTo(47.24 + 0.7, 2)
    expect(paper.radiusPt).toBeCloseTo(inPt(0.075) + mmPt(0.35), 6)
    const immersive = printFinalCodeBlock({ look: 'immersive' }, tile, 2)
    expect(immersive.widthPt).toBe(inPt(1.5))
    expect(immersive.heightPt).toBeCloseTo(inPt(1.96), 6)
  })
})

describe('choices and refusals (spec 12)', () => {
  it('keeps tents off the print shop', () => {
    expect(refusalOf({ piece: 'tent', printer: 'print_shop' })).toBe('tents_office_only')
    expect(
      refusalOf({ piece: 'counter', printer: 'print_shop', look: 'immersive' }),
    ).toBeNull()
    expect(refusalOf({ piece: 'small', printer: 'print_shop' })).toBeNull()
  })

  it('takes a whole quantity from 1 to 1000 and one or two languages', () => {
    expect(refusalOf({ quantity: 0 })).toBe('quantity_out_of_range')
    expect(refusalOf({ quantity: 2.5 })).toBe('quantity_out_of_range')
    expect(refusalOf({ quantity: PRINT_FINAL_MAX_QUANTITY + 1 })).toBe(
      'quantity_out_of_range',
    )
    expect(refusalOf({ quantity: PRINT_FINAL_MAX_QUANTITY })).toBeNull()
    expect(PRINT_FINAL_MAX_QUANTITY).toBe(1000)
    expect(refusalOf({ languageCount: 3 })).toBe('languages_out_of_range')
    expect(refusalOf({ languageCount: 0 })).toBe('languages_out_of_range')
  })

  it('offers all three pieces on the short address and holds tents and Small cards on the long one', () => {
    const { piece: _piece, ...rest } = choice()
    expect(printFinalPieceOffers(rest, SHORT).map((o) => o.refusal)).toEqual([
      null,
      null,
      null,
    ])
    expect(printFinalPieceOffers(rest, LONG).map((o) => o.refusal?.code ?? null)).toEqual(
      [null, 'needs_short_code', 'needs_short_code'],
    )
  })
})

describe('sheets (fixed rule Y)', () => {
  it('fits Paper 3 / 4 / 10 and Immersive 2 / 2 / 8 on Letter, Paper 4 / 4 / 10 and Immersive 2 / 2 / 9 on A4', () => {
    expect(PRINT_FINAL_PER_SHEET.counter).toEqual({
      paper: { letter: 3, a4: 4 },
      immersive: { letter: 2, a4: 2 },
    })
    expect(PRINT_FINAL_PER_SHEET.tent).toEqual({
      paper: { letter: 4, a4: 4 },
      immersive: { letter: 2, a4: 2 },
    })
    expect(PRINT_FINAL_PER_SHEET.small).toEqual({
      paper: { letter: 10, a4: 10 },
      immersive: { letter: 8, a4: 9 },
    })
  })

  it('lets the quantity decide the sheets, and fills the last one only when asked', () => {
    expect(printFinalSheetCount(10, 4)).toBe(3)
    expect(printFinalSheetCount(8, 4)).toBe(2)
    expect(printFinalPieceCount(10, 4, false)).toBe(10)
    expect(printFinalPieceCount(10, 4, true)).toBe(12)
  })
})
