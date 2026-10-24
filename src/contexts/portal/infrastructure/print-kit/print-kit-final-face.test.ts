import { describe, expect, it } from 'vitest'
import golden from '#/shared/domain/__fixtures__/portal-print-final-golden.json'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { PRINT_KIT_COPY, type PrintTextBlock } from '#/shared/domain/portal-print-kit'
import type { PrintFinalFace, PrintFinalPiece } from '#/shared/domain/portal-print-final'
import { choosePrintFinalTile } from '#/shared/domain/portal-print-final-code'
import {
  layoutPrintFinalFace,
  type PrintFinalBrandInput,
} from '#/shared/domain/portal-print-final-face'
import { mmPt, ptMm } from '#/shared/domain/portal-print-final-measures'
import { newDocument } from './__fixtures__/print-kit-face-fixtures'
import { pdfFinalMeasurer } from './print-kit-final-face'

// The final faces as the PDF lays them out, measured with the embedded fonts'
// own glyph outlines, against the design boards (final-design-2026-10-25):
// every Paper card of the stand-in set must put each part's ink, at the size the
// board measured, where the board put it, within 0.25 mm. The boards draw the
// tile's outline at the browser's 0.26 mm where the PDF draws 0.35 mm; the
// tolerance covers it.

type GoldenCard = (typeof golden.cards)[number]

const TOLERANCE_MM = 0.25
const SYMBOL_MODULES = { short: 29, long: 53 } as const

const BOARD_COPY = {
  en: { kicker: 'Review us on Google', ...PRINT_KIT_COPY.en.rate },
  es: { kicker: 'Review us on Google', ...PRINT_KIT_COPY.es.rate },
  // The boards' German, longer than the kit's draft: it is the long-copy case.
  de: {
    kicker: 'Bewerten Sie uns auf Google',
    headline: 'Bewerten Sie Ihren Aufenthalt',
    subline: 'Vertraulich, etwa 30 Sekunden',
  },
} as const

const paperCards = golden.cards.filter(
  (card) => card.look === 'paper' && card.board !== 'tile-ladder',
)

const faceOf = (card: GoldenCard): PrintFinalFace => ({
  piece: card.piece as PrintFinalPiece,
  orientation: card.orientation as PrintFinalFace['orientation'],
  look: 'paper',
  region: card.region as PrintFinalFace['region'],
})

function blocksOf(card: GoldenCard): readonly PrintTextBlock[] {
  const languages: readonly GuestLocale[] =
    card.board === 'long-text' ? ['de'] : card.languages === 'one' ? ['en'] : ['en', 'es']
  return languages.map((locale) => ({
    locale,
    ...BOARD_COPY[locale as 'en' | 'es' | 'de'],
  }))
}

function brandOf(card: GoldenCard): PrintFinalBrandInput {
  if (card.board === 'no-logo') return { kind: 'wordmark', text: 'Hotel Elegance' }
  const brand = card.parts.find((part) => part.key === 'brand')
  return {
    kind: 'logo',
    inkWidth: brand?.w ?? 1,
    inkHeight: brand?.h ?? 1,
    onPlate: false,
  }
}

const { doc, fonts } = newDocument()

function laidOut(card: GoldenCard) {
  const face = faceOf(card)
  const address = card.address as 'short' | 'long'
  const tile = choosePrintFinalTile({
    ...face,
    address,
    symbolModules: SYMBOL_MODULES[address],
  })
  return layoutPrintFinalFace({
    face,
    blocks: blocksOf(card),
    brand: brandOf(card),
    tile: tile._unsafeUnwrap(),
    measurer: pdfFinalMeasurer(doc, fonts),
  })
}

const near = (actual: number, expected: number, what: string) =>
  expect(
    Math.abs(actual - expected),
    `${what}: ${actual} against ${expected}`,
  ).toBeLessThanOrEqual(TOLERANCE_MM)

const nameOf = (card: GoldenCard) =>
  `${card.board}: ${card.piece} ${card.orientation} (${card.region}, ${card.address})`

describe('the final Paper faces in the PDF against the boards', () => {
  it('covers the family, Europe, the long address, two languages, no logo and long copy', () => {
    expect(new Set(paperCards.map((card) => card.board)).size).toBe(6)
    expect(paperCards).toHaveLength(32)
  })

  it.each(paperCards.map((card) => [nameOf(card), card] as const))(
    '%s: the headline size, every part’s ink and the code block are the board’s',
    (_, card) => {
      const laid = laidOut(card)
      expect(laid.headlinePt).toBe(card.headlinePt)
      expect(laid.plan.problems).toEqual([])
      expect(laid.plan.parts.map((part) => part.key)).toEqual(
        card.parts.map((part) => part.key),
      )
      card.parts.forEach((expected, index) => {
        const part = laid.plan.parts[index]
        const what = `${expected.key}`
        near(ptMm(part?.xPt ?? NaN), expected.l, `${what} left`)
        near(ptMm(part?.yPt ?? NaN), expected.t, `${what} top`)
        near(ptMm(part?.widthPt ?? NaN), expected.w, `${what} width`)
        near(ptMm(part?.heightPt ?? NaN), expected.h, `${what} height`)
      })
      near(ptMm(laid.plan.code.leftPt), card.tile.l, 'tile left')
      near(ptMm(laid.plan.code.topPt), card.tile.t, 'tile top')
      near(ptMm(laid.plan.code.rightPt), card.tile.r, 'tile right')
      near(ptMm(laid.plan.code.bottomPt), card.tile.b, 'tile bottom')
    },
  )

  it('draws the tile’s outline at 0.35 mm outside the cream square', () => {
    const [card] = paperCards
    if (card === undefined) throw new Error('a Paper card')
    const { code } = laidOut(card)
    expect(code.widthPt - code.tilePt).toBeCloseTo(mmPt(0.7))
  })
})
