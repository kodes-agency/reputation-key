// The small table tent's face against the round-3 boards (spec-delta S5, S3
// "Measured": tent faces): imm-tent-small-oakmere and paper-tent-small-harborline,
// to half a point, on the short address's 1.4 in tile. Then what the tent drops
// (the name, the second language), and long copy in every language. The words
// are measured with the preview's width tables, which err wide; the PDF's own
// fonts are tested in the print kit's infrastructure.

import { describe, expect, it } from 'vitest'
import { GUEST_LOCALES } from './guest-locale'
import {
  PRINT_KIT_CALLS_TO_ACTION,
  PRINT_KIT_STYLES,
  printKitFaces,
  type PrintKitCallToAction,
  type PrintKitPaper,
  type PrintKitStyle,
  type PrintKitWords,
} from './portal-print-kit'
import type { CardBrandInput } from './portal-print-kit-card-brand'
import type { CardLine, CardTextMeasure } from './portal-print-kit-card-words'
import {
  cueLinesFor,
  estimatedCueWidthPt,
  planCodeBlock,
} from './portal-print-kit-code-block'
import { CODE_TILE } from './portal-print-kit-code-tile'
import { CODE_BLOCK, inToPt, mmToPt } from './portal-print-kit-measures'
import { planTent, TENT_WORDS_GAP_MIN_PT, type TentPlan } from './portal-print-kit-tent'
import { estimatedLineWidthPt } from './portal-print-kit-text-widths'

const measure: CardTextMeasure = (text, style) =>
  estimatedLineWidthPt(
    text,
    style.face === 'display' ? 'display' : 'text',
    style.sizePt,
    style.trackingEm,
  )

/** The boards' brands: Oakmere's tree-mark on its plate, Harborline's badge on paper, Elegance's wordmark. */
const OAKMERE = { kind: 'logo', inkAspect: 327 / 321, plate: true } as const
const HARBORLINE = { kind: 'logo', inkAspect: 766 / 426, plate: false } as const
const ELEGANCE = { kind: 'wordmark', text: 'Hotel Elegance' } as const

type Options = Readonly<{
  style?: PrintKitStyle
  paper?: PrintKitPaper
  languages?: PrintKitWords['languages']
  callToAction?: PrintKitCallToAction
  brand?: CardBrandInput
  side?: 0 | 1
}>

function plan(options: Options = {}): TentPlan {
  const faces = printKitFaces(
    {
      piece: 'table_tent',
      languages: options.languages ?? ['en'],
      callToAction: options.callToAction ?? 'rate',
    },
    { en: 'Reception', es: 'Recepción', bg: 'Рецепция' },
    'Reception',
  )
  const face = faces[options.side ?? 0]
  if (face === undefined) throw new Error('no face')
  const paper = options.paper ?? 'letter'
  const lead = face.blocks.slice(0, 1).map((block) => block.locale)
  return planTent({
    style: options.style ?? 'immersive',
    paper,
    face,
    brand: options.brand ?? OAKMERE,
    code: planCodeBlock(cueLinesFor(lead), estimatedCueWidthPt, CODE_TILE.table[paper]),
    measure,
    wordmarkInkTopPt: (sizePt) => mmToPt(0.3) * (sizePt / 16),
  })
}

const lines = (tent: TentPlan, role: CardLine['role']) =>
  tent.words.filter(
    (item): item is CardLine => item.kind === 'line' && item.role === role,
  )

const codeFoot = (tent: TentPlan) => tent.code.y + tent.code.plan.heightPt
const wordsFoot = (tent: TentPlan) =>
  Math.max(
    ...tent.words.map((item) => item.topPt + ('heightPt' in item ? item.heightPt : 0)),
  )

/** Where the brand's ink starts, from the top of the trim. */
const brandInkTop = (tent: TentPlan): number =>
  tent.brand.kind === 'logo' ? (tent.brand.plate ?? tent.brand.ink).y : tent.brand.box.y

describe('the Immersive small tent, as imm-tent-small-oakmere', () => {
  it('is a 5 × 3.5 in landscape face with the 1.2 in photo panel down its left', () => {
    const tent = plan()
    expect([tent.widthPt, tent.heightPt]).toEqual([inToPt(5), inToPt(3.5)])
    expect(tent.panelPt).toBeCloseTo(86.4, 6)
  })

  it('stands the 1.4 in code block from 64.8 to 187.2 pt: 0.9 in of fold and foot clearance', () => {
    const tent = plan()
    expect(tent.code.plan.tile.tilePt).toBeCloseTo(inToPt(1.4), 6)
    expect(tent.code.y).toBeCloseTo(64.8, 1)
    expect(codeFoot(tent)).toBeCloseTo(187.2, 1)
    expect(tent.heightPt - codeFoot(tent)).toBeCloseTo(tent.code.y, 6)
  })

  it('sets the code 18 pt in from the right edge, and the words 18 pt from the panel to 14 pt short of the code', () => {
    const tent = plan()
    expect(tent.code.x + tent.code.plan.tile.tilePt).toBeCloseTo(inToPt(5) - 18, 6)
    expect(tent.column.x).toBeCloseTo(86.4 + 18, 6)
    expect(tent.column.x + tent.column.widthPt).toBeCloseTo(tent.code.x - 14, 6)
  })

  it('puts the plate’s top on the code’s top at the column’s left edge, and the sub-line’s foot on the bar’s foot', () => {
    const tent = plan()
    if (tent.brand.kind !== 'logo' || tent.brand.plate === null) {
      throw new Error('expected a plate')
    }
    expect(tent.brand.plate.y).toBeCloseTo(tent.code.y, 6)
    expect(tent.brand.plate.x).toBeCloseTo(tent.column.x, 6)
    expect(wordsFoot(tent)).toBeCloseTo(codeFoot(tent), 6)
  })

  it('sets the eyebrow at 9 pt, the call to action at 20 pt and the sub-line at 9.5 pt, with no name line', () => {
    const tent = plan()
    expect(lines(tent, 'eyebrow')[0]?.style.sizePt).toBe(9)
    expect(lines(tent, 'cta')[0]?.style.sizePt).toBe(20)
    expect(lines(tent, 'sub')[0]?.style.sizePt).toBe(9.5)
    expect(lines(tent, 'name')).toEqual([])
    expect(tent.ctaPt).toBe(20)
  })
})

describe('the Paper small tent, as paper-tent-small-harborline', () => {
  it('has no panel: the words start 22 pt in and the code’s outline ends 22 pt from the right edge', () => {
    const tent = plan({ style: 'paper', brand: HARBORLINE })
    expect(tent.panelPt).toBeNull()
    expect(tent.column.x).toBe(22)
    expect(tent.code.x + tent.code.plan.tile.tilePt + CODE_BLOCK.outlinePt).toBeCloseTo(
      inToPt(5) - 22,
      6,
    )
    expect(tent.column.x + tent.column.widthPt).toBeCloseTo(
      tent.code.x - CODE_BLOCK.outlinePt - 14,
      6,
    )
  })

  it('sets the call to action at 26 pt, the logo’s top on the code’s top, the row centred', () => {
    const tent = plan({ style: 'paper', brand: HARBORLINE })
    expect(lines(tent, 'cta')[0]?.style.sizePt).toBe(26)
    expect(brandInkTop(tent)).toBeCloseTo(tent.code.y, 6)
    expect(tent.code.y).toBeCloseTo(64.8, 1)
    expect(wordsFoot(tent)).toBeCloseTo(codeFoot(tent), 6)
  })

  it('starts a wordmark’s caps, not its line box, on the code’s top', () => {
    const tent = plan({ style: 'paper', brand: ELEGANCE })
    if (tent.brand.kind !== 'wordmark') throw new Error('expected a wordmark')
    expect(tent.brand.box.x).toBe(22)
    const inkTop =
      tent.brand.box.y + mmToPt(0.3) * ((tent.brand.lines[0]?.style.sizePt ?? 0) / 16)
    expect(inkTop).toBeCloseTo(tent.row.topPt, 6)
    expect(tent.brand.lines[0]?.style.sizePt).toBe(13)
  })
})

describe('one language a face (round-2 R3)', () => {
  it('prints the lead language on the front and the second on the back, each with no second call to action', () => {
    const front = plan({ languages: ['en', 'es'] })
    const back = plan({ languages: ['en', 'es'], side: 1 })
    expect(lines(front, 'cta').map((line) => line.locale)).toEqual(['en'])
    expect(lines(back, 'cta').map((line) => line.locale)).toEqual(['es'])
    for (const tent of [front, back]) {
      expect(lines(tent, 'cta2')).toEqual([])
      expect(tent.words.some((item) => item.kind === 'rule')).toBe(false)
      expect(lines(tent, 'eyebrow')).toHaveLength(1)
    }
    expect(lines(back, 'eyebrow')[0]?.text).toBe('RECEPCIÓN')
  })
})

describe('Europe', () => {
  it('is 130 × 90 mm with the 36 mm tile, its row centred', () => {
    const tent = plan({ paper: 'a4', languages: ['en', 'bg'], brand: ELEGANCE })
    expect(tent.widthPt).toBeCloseTo(mmToPt(130), 6)
    expect(tent.heightPt).toBeCloseTo(mmToPt(90), 6)
    expect(tent.code.plan.tile.tilePt).toBeCloseTo(mmToPt(36), 6)
    expect(tent.code.y).toBeCloseTo(tent.heightPt - codeFoot(tent), 6)
  })
})

describe('long copy', () => {
  const cases = PRINT_KIT_STYLES.flatMap((style) =>
    [OAKMERE, ELEGANCE].flatMap((brand) =>
      GUEST_LOCALES.flatMap((locale) =>
        PRINT_KIT_CALLS_TO_ACTION.map((callToAction) => ({
          style,
          brand,
          locale,
          callToAction,
        })),
      ),
    ),
  )

  it.each(cases)(
    '$style, $brand.kind, $locale, $callToAction: the words keep their gap and their column, the row centred with at least 0.5 in clearance',
    ({ style, brand, locale, callToAction }) => {
      const tent = plan({ style, brand, languages: [locale], callToAction })
      const top = brandInkTop(tent)
      const firstWord = Math.min(...tent.words.map((item) => item.topPt))
      expect(firstWord - top).toBeGreaterThanOrEqual(TENT_WORDS_GAP_MIN_PT)
      expect(tent.row.heightPt).toBeGreaterThanOrEqual(tent.code.plan.heightPt)
      expect(tent.row.topPt).toBeCloseTo(
        tent.heightPt - tent.row.topPt - tent.row.heightPt,
        6,
      )
      expect(tent.row.topPt).toBeGreaterThanOrEqual(inToPt(0.5))
      for (const line of tent.words.filter((item) => item.kind === 'line')) {
        expect(line.widthPt).toBeLessThanOrEqual(tent.column.widthPt + 0.01)
      }
    },
  )

  it('steps the call to action down before the row grows: French "tell" on Immersive', () => {
    const tent = plan({ languages: ['fr'], callToAction: 'tell' })
    expect(tent.ctaPt).toBeLessThan(20)
    expect(tent.ctaPt).toBeGreaterThanOrEqual(16)
  })
})
