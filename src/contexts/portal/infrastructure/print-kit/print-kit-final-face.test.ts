import { describe, expect, it, vi } from 'vitest'
import golden from '#/shared/domain/__fixtures__/portal-print-final-golden.json'
import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { PrintFinalFace, PrintFinalPiece } from '#/shared/domain/portal-print-final'
import { choosePrintFinalTile } from '#/shared/domain/portal-print-final-code'
import {
  layoutPrintFinalFace,
  type PrintFinalBrandInput,
} from '#/shared/domain/portal-print-final-face'
import { mmPt, ptMm } from '#/shared/domain/portal-print-final-measures'
import { newDocument } from './__fixtures__/print-kit-face-fixtures'
import { drawText, pdfFinalMeasurer } from './print-kit-final-face'

// The final faces as the PDF lays them out, measured with the embedded fonts'
// own glyph outlines, against the design boards (final-design-2026-10-25):
// every Paper card of the stand-in set must put each part's ink, at the size the
// board measured, where the board put it, within 0.25 mm. The boards draw the
// tile's outline at the browser's 0.26 mm where the PDF draws 0.35 mm; the
// tolerance covers it.

type GoldenCard = (typeof golden.cards)[number]

const TOLERANCE_MM = 0.25
const SYMBOL_MODULES = { short: 29, long: 53 } as const

const paperCards = golden.cards.filter(
  (card) => card.look === 'paper' && card.board !== 'tile-ladder',
)

const faceOf = (card: GoldenCard): PrintFinalFace => ({
  piece: card.piece as PrintFinalPiece,
  orientation: card.orientation as PrintFinalFace['orientation'],
  look: 'paper',
  region: card.region as PrintFinalFace['region'],
})

/** The words the board printed: its kicker, headline and sub-line in each language. */
const blocksOf = (card: GoldenCard): readonly PrintTextBlock[] =>
  card.blocks.map((block) => ({ ...block, locale: block.locale as GuestLocale }))

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
  it('covers the family, Europe, the long address, two languages, no logo, German and the scan cues', () => {
    expect(new Set(paperCards.map((card) => card.board)).size).toBe(7)
    expect(paperCards).toHaveLength(44)
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

describe('a manager’s own headline in the embedded font (spec 5.7, measured US Paper)', () => {
  const HARBORLINE = {
    kind: 'logo',
    inkWidth: 22.8,
    inkHeight: 12.68,
    onPlate: false,
  } as const

  function layoutWords(
    piece: PrintFinalPiece,
    orientation: PrintFinalFace['orientation'],
    headline: string,
  ) {
    const face: PrintFinalFace = { piece, orientation, look: 'paper', region: 'us' }
    const tile = choosePrintFinalTile({ ...face, address: 'short', symbolModules: 29 })
    return layoutPrintFinalFace({
      face,
      blocks: [
        {
          locale: 'en',
          kicker: 'Review us on Google',
          headline,
          subline: 'About 30 seconds',
        },
      ],
      brand: HARBORLINE,
      tile: tile._unsafeUnwrap(),
      measurer: pdfFinalMeasurer(doc, fonts),
    })
  }

  const linesOf = (laid: ReturnType<typeof layoutWords>) =>
    laid.plan.parts.find((part) => part.key === 'headline')?.lines

  it('prints "Thanks for staying with us" at full size on two lines', () => {
    const headline = 'Thanks for staying with us'
    expect(layoutWords('counter', 'upright', headline)).toMatchObject({
      headlinePt: 28,
      overflows: false,
    })
    for (const orientation of ['upright', 'wide'] as const) {
      const tent = layoutWords('tent', orientation, headline)
      expect([tent.headlinePt, linesOf(tent), tent.overflows]).toEqual([19, 2, false])
    }
    expect(layoutWords('small', 'wide', headline)).toMatchObject({
      headlinePt: 15,
      overflows: false,
    })
  })

  it('steps "How was your stay with us tonight?" to 17 pt on both tents, the size the pair needs', () => {
    const headline = 'How was your stay with us tonight?'
    for (const orientation of ['upright', 'wide'] as const) {
      const tent = layoutWords('tent', orientation, headline)
      expect([tent.headlinePt, linesOf(tent), tent.overflows]).toEqual([17, 2, false])
    }
    expect(layoutWords('counter', 'upright', headline).headlinePt).toBe(28)
    expect(layoutWords('small', 'wide', headline).headlinePt).toBe(15)
  })

  it('refuses the 48-character headline on the upright tent, and prints it at the floor on the wide one', () => {
    const headline = 'Tell us how your visit went today, in a few taps'
    const upright = layoutWords('tent', 'upright', headline)
    expect(upright.overflows).toBe(true)
    expect(upright.plan.problems).toContain('gap_under_4u')
    const wide = layoutWords('tent', 'wide', headline)
    expect([wide.headlinePt, linesOf(wide), wide.overflows]).toEqual([16.5, 3, false])
    expect(layoutWords('counter', 'upright', headline)).toMatchObject({
      headlinePt: 28,
      overflows: false,
    })
    const counter = layoutWords('counter', 'upright', headline)
    expect(linesOf(counter)).toBe(3)
    const small = layoutWords('small', 'wide', headline)
    expect([small.headlinePt, linesOf(small), small.overflows]).toEqual([15, 3, false])
  })
})

describe('lining figures in a headline (spec 3)', () => {
  it('sets "30" in Cormorant with its lining glyphs, not the old-style ones', () => {
    const face: PrintFinalFace = {
      piece: 'tent',
      orientation: 'wide',
      look: 'paper',
      region: 'us',
    }
    const tile = choosePrintFinalTile({ ...face, address: 'short', symbolModules: 29 })
    const laid = layoutPrintFinalFace({
      face,
      blocks: [
        {
          locale: 'en',
          kicker: 'Review us on Google',
          headline: 'Got 30 seconds?',
          subline: 'Tell us how it went',
        },
      ],
      brand: { kind: 'wordmark', text: 'Hotel Elegance' },
      tile: tile._unsafeUnwrap(),
      measurer: pdfFinalMeasurer(doc, fonts),
    })
    const index = laid.plan.parts.findIndex((part) => part.key === 'headline')
    const part = laid.plan.parts[index]
    const content = laid.contents[index]
    if (part === undefined || content?.kind !== 'words') throw new Error('a headline')

    const asked: (Record<string, boolean> | undefined)[] = []
    const original = doc.text.bind(doc) as (...args: unknown[]) => PDFKit.PDFDocument
    const spy = vi.spyOn(doc, 'text').mockImplementation(((...args: unknown[]) => {
      const options = args[3] as { features?: Record<string, boolean> }
      asked.push(options.features === undefined ? undefined : { ...options.features })
      return original(...args)
    }) as never)
    drawText(doc, fonts, content.set, part, '#121614')
    spy.mockRestore()

    expect(asked).toEqual([{ lnum: true }])
    const { _font: font } = doc as unknown as {
      _font: {
        layout: (
          text: string,
          features?: Record<string, boolean>,
        ) => { glyphs: readonly { name: string }[] }
      }
    }
    const names = (features?: Record<string, boolean>) =>
      font.layout('Got 30 seconds?', features).glyphs.map((glyph) => glyph.name)
    expect(names({ lnum: true })).toEqual(expect.arrayContaining(['three.lf', 'zero.lf']))
    expect(names()).not.toContain('three.lf')
  })
})
