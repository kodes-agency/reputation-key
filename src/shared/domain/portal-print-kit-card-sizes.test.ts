// The Table and Mini cards' plans against the round-3 boards (spec-delta S3,
// "Measured"): imm-table-*, paper-table-*, imm-mini-oakmere and
// paper-mini-harborline, to half a point, on the short address's tiles; then the
// two-language Table steps (S4), what Mini drops, and the tile a long address
// leaves them (none). The words are measured with the preview's width tables,
// which err wide; the PDF's own fonts are tested in the print kit's
// infrastructure.

import QRCode from 'qrcode'
import { describe, expect, it } from 'vitest'
import {
  printKitFaces,
  type PrintKitPaper,
  type PrintKitSize,
  type PrintKitStyle,
  type PrintKitWords,
} from './portal-print-kit'
import type { CardBrandInput } from './portal-print-kit-card-brand'
import { cardFitSteps } from './portal-print-kit-card-fit'
import { cardTile, planCard, type CardPlan } from './portal-print-kit-card'
import type { CardLine, CardTextMeasure } from './portal-print-kit-card-words'
import {
  cueLinesFor,
  estimatedCueWidthPt,
  planCodeBlock,
} from './portal-print-kit-code-block'
import { CODE_TILE } from './portal-print-kit-code-tile'
import { inToPt, mmToPt } from './portal-print-kit-measures'
import { estimatedLineWidthPt } from './portal-print-kit-text-widths'

const measure: CardTextMeasure = (text, style) =>
  estimatedLineWidthPt(
    text,
    style.face === 'display' ? 'display' : 'text',
    style.sizePt,
    style.trackingEm,
  )

const TOKEN = `pt_${'A'.repeat(16)}_${'b'.repeat(43)}`
const BETA = `https://web-closed-beta-v2.up.railway.app/p/${TOKEN}?accessArtifact=0b6d1c1e-52c4-4b34-9d63-6e3b4a1f9a10`
const SHORT = 'HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R'
const modulesOf = (text: string) =>
  QRCode.create(text, { errorCorrectionLevel: 'M' }).modules.size

/** The boards' brands: Oakmere's tree-mark, Harborline's badge and Elegance's wordmark. */
const OAKMERE = { kind: 'logo', inkAspect: 327 / 321, plate: true } as const
const HARBORLINE = { kind: 'logo', inkAspect: 766 / 426, plate: true } as const
const ELEGANCE = { kind: 'wordmark', text: 'Hotel Elegance' } as const
const OAKMERE_NAME = 'Oakmere by Larkspur Hotel Houston Hobby Airport'
const HARBORLINE_NAME = 'Harborline Inn Houston-Near The Galleria'

type Options = Readonly<{
  size: PrintKitSize
  style?: PrintKitStyle
  paper?: PrintKitPaper
  languages?: PrintKitWords['languages']
  brand?: CardBrandInput
  name?: string | null
}>

function plan(options: Options): CardPlan {
  const [face] = printKitFaces(
    {
      piece: 'counter_card',
      languages: options.languages ?? ['en'],
      callToAction: 'rate',
    },
    { en: 'Reception', es: 'Recepción', bg: 'Рецепция' },
    'Portal',
  )
  if (face === undefined) throw new Error('no face')
  const paper = options.paper ?? 'letter'
  return planCard({
    size: options.size,
    style: options.style ?? 'immersive',
    paper,
    face,
    brand: options.brand ?? OAKMERE,
    propertyName: options.name === undefined ? OAKMERE_NAME : options.name,
    code: planCodeBlock(
      cueLinesFor(face.blocks.map((block) => block.locale)),
      estimatedCueWidthPt,
      CODE_TILE[options.size][paper],
    ),
    measure,
    wordmarkInkTopPt: (sizePt) => mmToPt(0.3) * (sizePt / 16),
  })
}

const lines = (card: CardPlan, role: CardLine['role']) =>
  card.words.filter(
    (item): item is CardLine => item.kind === 'line' && item.role === role,
  )

/** The code block's top and its bar's foot, from the top of the trim. */
const codeSpan = (card: CardPlan) => [card.code.y, card.code.y + card.code.plan.heightPt]

describe('the Immersive Table card, as the imm-table boards', () => {
  it.each([
    ['Oakmere, its name on two lines', OAKMERE, OAKMERE_NAME, 20.6],
    ['Harborline', HARBORLINE, HARBORLINE_NAME, 21.5],
    ['Elegance, a wordmark', ELEGANCE, null, 30.9],
  ] as const)(
    '%s: keeps the 1.1 in band and shares the spare height into two gaps of the board’s',
    (_, brand, name, gapPt) => {
      const card = plan({ size: 'table', brand, name })
      expect(card.bandPt).toBeCloseTo(79.2, 1)
      expect(Math.abs(card.gapPt - gapPt)).toBeLessThan(0.5)
      expect(card.stepIndex).toBe(0)
    },
  )

  it('stands the 1.4 in code block from 216 to 338 pt, on the 22 pt margin of a 5 in trim', () => {
    const card = plan({ size: 'table' })
    const [top = 0, foot = 0] = codeSpan(card)
    expect(Math.abs(top - 216)).toBeLessThan(0.5)
    expect(foot).toBeCloseTo(inToPt(5) - 22, 6)
    expect(card.code.plan.tile.tilePt).toBeCloseTo(inToPt(1.4), 6)
    expect(card.code.x).toBeCloseTo((inToPt(3.5) - inToPt(1.4)) / 2, 6)
  })

  it('sets the name at 7.5 pt, the eyebrow at 9 pt and the call to action at 24 pt, in an 18 pt side margin', () => {
    const card = plan({ size: 'table' })
    expect(lines(card, 'name')[0]?.style.sizePt).toBe(7.5)
    expect(lines(card, 'eyebrow')[0]?.style.sizePt).toBe(9)
    expect(lines(card, 'cta')[0]?.style.sizePt).toBe(24)
    expect(card.column).toEqual({ x: 18, widthPt: inToPt(3.5) - 36 })
  })

  it('takes every two-language step, as imm-table-oakmere-en-es: the band at 0.95 in, 21 pt, 9 pt and 12 pt, the gaps at their 12 pt minimum', () => {
    const card = plan({ size: 'table', languages: ['en', 'es'] })
    expect(card.bandPt).toBeCloseTo(68.4, 1)
    expect(Math.abs(card.gapPt - 12)).toBeLessThan(0.5)
    expect(card.step).toMatchObject({ ctaPt: 21, subPt: 9, cta2Pt: 12, name: true })
    const [top = 0] = codeSpan(card)
    expect(Math.abs(top - 210)).toBeLessThan(0.5)
  })

  it('prints the Europe card on 90 × 130 mm with the 36 mm tile, its bar’s foot on the 22 pt margin', () => {
    const card = plan({
      size: 'table',
      paper: 'a4',
      languages: ['en', 'bg'],
      brand: ELEGANCE,
      name: null,
    })
    expect([card.widthPt, card.heightPt]).toEqual([mmToPt(90), mmToPt(130)])
    expect(card.code.plan.tile.tilePt).toBeCloseTo(mmToPt(36), 6)
    const [top = 0, foot = 0] = codeSpan(card)
    expect(Math.abs(top - 217)).toBeLessThan(0.5)
    expect(foot).toBeCloseTo(mmToPt(130) - 22, 6)
  })
})

describe('the Paper Table card, as the paper-table boards', () => {
  it.each([
    ['Harborline', { ...HARBORLINE, plate: false }, HARBORLINE_NAME, 42],
    ['Oakmere', { ...OAKMERE, plate: false }, OAKMERE_NAME, 41],
    ['Elegance', ELEGANCE, null, 64],
  ] as const)(
    '%s: two gaps of the board’s, the code block from 215 to 337 pt',
    (_, brand, name, gapPt) => {
      const card = plan({ size: 'table', style: 'paper', brand, name })
      expect(card.bandPt).toBeNull()
      expect(Math.abs(card.gapPt - gapPt)).toBeLessThan(0.6)
      const [top = 0, foot = 0] = codeSpan(card)
      expect(Math.abs(top - 215)).toBeLessThan(0.5)
      expect(Math.abs(foot - 337)).toBeLessThan(0.5)
      expect(lines(card, 'cta')[0]?.style.sizePt).toBe(26)
    },
  )
})

describe('the Mini card, as imm-mini-oakmere and paper-mini-harborline', () => {
  it('keeps the 0.75 in band on Immersive, two 14.6 pt gaps and the code block from 128 to 238 pt', () => {
    const card = plan({ size: 'mini' })
    expect(card.bandPt).toBeCloseTo(54, 1)
    expect(Math.abs(card.gapPt - 14.6)).toBeLessThan(0.5)
    const [top = 0, foot = 0] = codeSpan(card)
    expect(Math.abs(top - 128)).toBeLessThan(0.5)
    expect(foot).toBeCloseTo(inToPt(3.5) - 14.4, 6)
    expect(card.code.plan.tile.tilePt).toBeCloseTo(inToPt(1.25), 6)
  })

  it('prints the logo alone: no name and no eyebrow, the call to action at 17 pt and the sub-line at 8 pt', () => {
    const card = plan({ size: 'mini' })
    expect(lines(card, 'name')).toEqual([])
    expect(lines(card, 'eyebrow')).toEqual([])
    expect(lines(card, 'cta')[0]?.style.sizePt).toBe(17)
    expect(lines(card, 'sub')[0]?.style.sizePt).toBe(8)
    expect(card.column).toEqual({ x: 14, widthPt: inToPt(2) - 28 })
  })

  it('on Paper: one 30 pt gap each side of the message, the call to action at 18 pt, the code block from 127 to 237 pt', () => {
    const card = plan({
      size: 'mini',
      style: 'paper',
      brand: { ...HARBORLINE, plate: false },
    })
    expect(Math.abs(card.gapPt - 30)).toBeLessThan(0.5)
    expect(lines(card, 'cta')[0]?.style.sizePt).toBe(18)
    const [top = 0, foot = 0] = codeSpan(card)
    expect(Math.abs(top - 127)).toBeLessThan(0.5)
    expect(Math.abs(foot - 237)).toBeLessThan(0.5)
  })

  it('prints on 55 × 85 mm in Europe with the 32 mm tile', () => {
    const card = plan({ size: 'mini', paper: 'a4' })
    expect([card.widthPt, card.heightPt]).toEqual([mmToPt(55), mmToPt(85)])
    expect(card.code.plan.tile.tilePt).toBeCloseTo(mmToPt(32), 6)
  })
})

describe('cardFitSteps', () => {
  it('steps a Table card’s call to action 24 to 21 pt (on one line down to 20), its sub-line to 9 pt and its second call to action to 12 pt, then again without the name', () => {
    expect(
      cardFitSteps('table', 'immersive').map((step) => [
        step.ctaPt,
        step.ctaOneLineFloorPt,
        step.subPt,
        step.cta2Pt,
        step.name,
      ]),
    ).toEqual([
      [24, null, 9.5, 13, true],
      [21, 20, 9.5, 13, true],
      [21, 20, 9, 13, true],
      [21, 20, 9, 12, true],
      [24, null, 9.5, 13, false],
      [21, 20, 9.5, 13, false],
      [21, 20, 9, 13, false],
      [21, 20, 9, 12, false],
    ])
  })

  it('keeps Paper’s Table call to action 2 pt above Immersive’s at every step', () => {
    const paper = cardFitSteps('table', 'paper').map((step) => step.ctaPt)
    const immersive = cardFitSteps('table', 'immersive').map((step) => step.ctaPt)
    expect(paper).toEqual(immersive.map((pt) => pt + 2))
  })

  it('gives Mini one step, a call to action 2 pt smaller, and never the name', () => {
    const steps = cardFitSteps('mini', 'immersive')
    expect(steps.map((step) => [step.ctaPt, step.name])).toEqual([
      [17, false],
      [15, false],
    ])
  })

  it('gives Large its own steps', () => {
    expect(cardFitSteps('large', 'paper')[0]?.ctaPt).toBe(30)
  })
})

describe('cardTile', () => {
  it('refuses today’s long beta address on Table and Mini: it needs a short code', () => {
    const address = { text: BETA, symbolModules: modulesOf(BETA) }
    for (const size of ['table', 'mini'] as const) {
      const choice = cardTile(size, 'letter', address)
      expect(choice.isErr() && choice.error).toMatchObject({
        code: 'print_code_too_small',
        cause: 'needs_short_code',
        size,
      })
    }
  })

  it('gives Table and Mini their tiles for the short address, at or over the 0.85 mm floor', () => {
    const address = { text: SHORT, symbolModules: modulesOf(SHORT) }
    const table = cardTile('table', 'letter', address)
    const mini = cardTile('mini', 'a4', address)
    expect(table.isOk() && table.value.tile.tilePt).toBeCloseTo(inToPt(1.4), 6)
    expect(mini.isOk() && mini.value.tile.tilePt).toBeCloseTo(mmToPt(32), 6)
    expect(mini.isOk() && mini.value.moduleMm).toBeGreaterThanOrEqual(0.85)
  })
})
