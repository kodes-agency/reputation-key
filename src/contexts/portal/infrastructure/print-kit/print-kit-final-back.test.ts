import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import golden from '#/shared/domain/__fixtures__/portal-print-final-back-golden.json'
import type { PrintFinalRenderInput } from '../../application/ports/portal-print-final-renderer.port'
import {
  printFinalRegionOf,
  type PrintFinalFace,
  type PrintFinalPiece,
} from '#/shared/domain/portal-print-final'
import { layoutPrintFinalBack } from '#/shared/domain/portal-print-final-back'
import type { PrintFinalBrandInput } from '#/shared/domain/portal-print-final-face'
import {
  printFinalLiveArea,
  mmPt,
  ptMm,
} from '#/shared/domain/portal-print-final-measures'
import { printKitFaces } from '#/shared/domain/portal-print-kit'
import { newDocument } from './__fixtures__/print-kit-face-fixtures'
import { createPdfKitPrintFinalRenderer } from './pdfkit-print-final-renderer'
import { pdfFinalMeasurer } from './print-kit-final-face'

// The optional back page as a PDF (final design spec §10.4): laid out with the
// guest fonts' own glyph outlines against the back-side board, then added after
// its front where a lone piece is printed, and after each sheet where sheets are.

const SHORT = 'HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R'
const NAME = 'Harborline Inn Millbrook-Near The Arboretum'

const renderer = createPdfKitPrintFinalRenderer({
  now: () => new Date('2026-10-25T10:00:00Z'),
  compress: false,
})

const { doc, fonts } = newDocument()

const near = (actual: number, expected: number, tolerance: number, what: string) =>
  expect(
    Math.abs(actual - expected),
    `${what}: ${actual} against ${expected}`,
  ).toBeLessThanOrEqual(tolerance)

/** The board's brand box: the logo alone on Paper, the logo on its plate (the padding is part of the box) on Immersive. */
function brandOf(card: (typeof golden.backs)[number]): PrintFinalBrandInput {
  if (card.look === 'paper') {
    return {
      kind: 'logo',
      inkWidth: card.brand.w,
      inkHeight: card.brand.h,
      onPlate: false,
    }
  }
  const plate = { counter: [6, 4], small: [3.2, 2] }[card.piece] ?? [0, 0]
  return {
    kind: 'logo',
    inkWidth: card.brand.w - (plate[0] ?? 0),
    inkHeight: card.brand.h - (plate[1] ?? 0),
    onPlate: true,
  }
}

describe('the back page as the PDF lays it out, against the back-side board', () => {
  // The board centred the boxes of the logo and of the name's lines, which left
  // about a millimetre of line spacing in the gap under the logo; the final
  // design places by ink, and the gap is 2u. The block is that much shorter and
  // sits up to 0.8 mm lower; sideways it is the board's to 0.1 mm.
  it.each(golden.backs.map((card) => [card.label, card] as const))(
    '%s: the name wraps and sets as wide as the board’s, and the block lands where its margins say',
    (_, card) => {
      const face: PrintFinalFace = {
        piece: card.piece as PrintFinalPiece,
        orientation: card.orientation as PrintFinalFace['orientation'],
        look: card.look as PrintFinalFace['look'],
        region: 'us',
      }
      const { plan, contents } = layoutPrintFinalBack({
        face,
        brand: brandOf(card),
        propertyName: card.label.split(': ')[1] ?? NAME,
        measurer: pdfFinalMeasurer(doc, fonts),
      })
      const name = plan.parts.find((part) => part.key === 'name')
      near(ptMm(name?.widthPt ?? NaN), card.name.w, 0.25, 'the name’s width')
      const set = contents.find((content) => content.kind === 'name')
      expect(set?.kind === 'name' ? set.set.lines : []).toHaveLength(2)
      const block = plan.block
      if (block === null) throw new Error('a back with a brand has a block')
      near(ptMm(block.leftPt), card.margins.L, 0.25, 'left')
      near(ptMm(plan.widthPt - block.rightPt), card.margins.R, 0.25, 'right')
      near(ptMm(block.topPt), card.margins.T, 1, 'top')
      near(ptMm(plan.heightPt - block.bottomPt), card.margins.B, 0.5, 'bottom')
    },
  )
})

async function logoBytes(): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: { width: 300, height: 100, channels: 4, background: '#1D4FC4' },
    })
      .png()
      .toBuffer(),
  )
}

async function inputFor(
  face: PrintFinalFace,
  over: Partial<PrintFinalRenderInput> = {},
): Promise<PrintFinalRenderInput> {
  const [front] = printKitFaces(
    { piece: 'counter_card', languages: ['en'], callToAction: 'rate' },
    { en: 'Review us on Google' },
    'Reception',
  )
  return {
    title: 'Harborline cards',
    face,
    blocks: front?.blocks ?? [],
    wordmark: 'Harborline',
    logo: await logoBytes(),
    accentColour: '#A8C6FE',
    fieldColour: '#16224A',
    photo: null,
    qrAddress: SHORT,
    address: 'short',
    ...over,
  }
}

const card = (
  piece: PrintFinalPiece,
  orientation: PrintFinalFace['orientation'],
  look: PrintFinalFace['look'] = 'paper',
  region: PrintFinalFace['region'] = 'us',
): PrintFinalFace => ({ piece, orientation, look, region })

const text = (pdf: Uint8Array) => Buffer.from(pdf).toString('latin1')
const sizes = (pdf: Uint8Array) =>
  [...text(pdf).matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/gu)].map((match) => [
    Math.round(Number(match[1])),
    Math.round(Number(match[2])),
  ])
const drawn = (pdf: Uint8Array, operator: string) =>
  text(pdf).split(new RegExp(`\\s${operator}\\s`, 'u')).length - 1

const BACK = { propertyName: NAME }

describe('a lone card with a back page', () => {
  it.each([
    ['counter', 'upright', 'paper', [288, 432]],
    ['counter', 'wide', 'immersive', [432, 288]],
    ['small', 'wide', 'paper', [252, 144]],
    ['small', 'upright', 'immersive', [144, 252]],
  ] as const)(
    'prints a %s %s %s card on two pages at its trim: the front, then the back',
    async (piece, orientation, look, size) => {
      const face = card(piece, orientation, look)
      const without = await renderer.render(await inputFor(face))
      const pdf = await renderer.render(await inputFor(face, { back: BACK }))
      expect(sizes(without)).toEqual([size])
      expect(sizes(pdf)).toEqual([size, size])
      // The back draws the logo again (Immersive's grain is a picture too), and the name besides.
      expect(drawn(pdf, 'Do')).toBeGreaterThan(drawn(without, 'Do'))
      expect(text(pdf).length).toBeGreaterThan(text(without).length)
    },
  )

  it('has no code on the back: the address is never drawn and the code block only once', async () => {
    const face = card('counter', 'upright')
    const one = await renderer.render(await inputFor(face))
    const two = await renderer.render(await inputFor(face, { back: BACK }))
    expect(text(two)).not.toContain('AP.UP.RAILWAY.APP')
    const rectangles = (pdf: Uint8Array) => (text(pdf).match(/\sre\s/gu) ?? []).length
    // A Paper back adds no rectangle: no tile, no bar, no art.
    expect(rectangles(two)).toBe(rectangles(one))
  })

  it('paints an Immersive back on the ground, as the front’s, and a Paper back on nothing', async () => {
    const immersive = card('counter', 'upright', 'immersive')
    const one = await renderer.render(await inputFor(immersive))
    const two = await renderer.render(await inputFor(immersive, { back: BACK }))
    const rectangles = (pdf: Uint8Array) => (text(pdf).match(/\sre\s/gu) ?? []).length
    expect(rectangles(two)).toBeGreaterThan(rectangles(one))
  })

  it('sets the wordmark and the name where there is no logo', async () => {
    const face = card('counter', 'upright')
    const pdf = await renderer.render(
      await inputFor(face, { logo: null, back: { propertyName: 'Harborline Lisbon' } }),
    )
    expect(sizes(pdf)).toHaveLength(2)
    expect(drawn(pdf, 'Do')).toBe(0)
  })

  it('refuses a tent’s back page: a tent prints its front on both faces', async () => {
    await expect(
      renderer.render(await inputFor(card('tent', 'wide'), { back: BACK })),
    ).rejects.toThrow(/no back page/u)
  })

  it('keeps the Europe Paper A6 card’s guard on the back, as on its front', () => {
    const face = card('counter', 'upright', 'paper', 'eu')
    const { live } = printFinalLiveArea(face)
    const { plan } = layoutPrintFinalBack({
      face,
      brand: { kind: 'logo', inkWidth: 2, inkHeight: 1, onPlate: false },
      propertyName: NAME,
      measurer: pdfFinalMeasurer(doc, fonts),
    })
    expect(plan.live).toEqual(live)
    expect(printFinalRegionOf('a4')).toBe('eu')
    expect(plan.parts[0]?.yPt).toBeGreaterThanOrEqual(mmPt(12.7) - 0.01)
  })
})

describe('sheets with a back page', () => {
  const sheets = (quantity: number) => ({ quantity, fillSpares: false })

  it('follows each sheet with its back, the same size: ten Letter Paper cards, four sheets, eight pages', async () => {
    const face = card('counter', 'upright')
    const pdf = await renderer.render(
      await inputFor(face, { sheets: sheets(10), back: BACK }),
    )
    expect(sizes(pdf)).toEqual(Array.from({ length: 8 }, () => [612, 792]))
  })

  it('draws a back in every filled cell of the sheet behind, and no marks on it', async () => {
    const face = card('counter', 'upright', 'immersive')
    const front = await renderer.render(await inputFor(face, { sheets: sheets(2) }))
    const both = await renderer.render(
      await inputFor(face, { sheets: sheets(2), back: BACK }),
    )
    expect(sizes(front)).toEqual([[792, 612]])
    expect(sizes(both)).toEqual([
      [792, 612],
      [792, 612],
    ])
    // Two cards, a logo and the ground's grain on the back of each.
    expect(drawn(both, 'Do')).toBeGreaterThan(drawn(front, 'Do') + 2)
  })

  it('prints a lone Letter Paper Counter sheet’s third card’s back across its cell, mirrored', async () => {
    const face = card('counter', 'upright')
    const pdf = await renderer.render(
      await inputFor(face, { sheets: sheets(3), back: BACK }),
    )
    expect(sizes(pdf)).toHaveLength(2)
    // The back page's third card is turned a quarter clockwise: its matrix is 0 1 -1 0.
    const pages = text(pdf).split(/\/Type \/Page\b/u)
    expect(pages.at(-1)).toMatch(/\s0 1 -1 0\s/u)
  })

  it('leaves a tent’s sheet alone: its faces print the front', async () => {
    await expect(
      renderer.render(
        await inputFor(card('tent', 'wide'), { sheets: sheets(4), back: BACK }),
      ),
    ).rejects.toThrow(/no back page/u)
  })
})
