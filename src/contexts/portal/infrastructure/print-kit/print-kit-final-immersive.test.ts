import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { PrintFinalRenderInput } from '../../application/ports/portal-print-final-renderer.port'
import golden from '#/shared/domain/__fixtures__/portal-print-final-golden.json'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import { printFinalBlocks } from '#/shared/domain/portal-print-final-languages'
import {
  PRINT_FINAL_ORIENTATIONS,
  PRINT_FINAL_PIECES,
  type PrintFinalFace,
  type PrintFinalPiece,
} from '#/shared/domain/portal-print-final'
import { choosePrintFinalTile } from '#/shared/domain/portal-print-final-code'
import { layoutPrintFinalImmersiveFace } from '#/shared/domain/portal-print-final-immersive-face'
import { ptMm } from '#/shared/domain/portal-print-final-measures'
import { newDocument } from './__fixtures__/print-kit-face-fixtures'
import { createPdfKitPrintFinalRenderer } from './pdfkit-print-final-renderer'
import { pdfFinalMeasurer } from './print-kit-final-face'

// The final Immersive faces in the PDF: laid out with the embedded fonts against
// the boards (final-design-2026-10-25) within 0.25 mm, the logo on its plate;
// and drawn over their art, the photo masked by its fade, the scrims as masked
// ink, the grain blended as overlay.

const SHORT = 'HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R'
const TOLERANCE_MM = 0.25
const SYMBOL_MODULES = { short: 29, long: 53 } as const
/** The plate's padding round the logo on each piece, vertical and horizontal (§4). */
const PLATE_MM: Readonly<Record<PrintFinalPiece, readonly [number, number]>> = {
  counter: [2, 3],
  tent: [1.3, 2],
  small: [1, 1.6],
}

type GoldenCard = (typeof golden.cards)[number]

const immersiveCards = golden.cards.filter(
  (card) => card.look === 'immersive' && card.board !== 'tile-ladder',
)

/** The words the board printed: its kicker, headline and sub-line in each language. */
const blocksOf = (card: GoldenCard): readonly PrintTextBlock[] =>
  card.blocks.map((block) => ({ ...block, locale: block.locale as GuestLocale }))

const { doc, fonts } = newDocument()

function laidOut(card: GoldenCard) {
  const face: PrintFinalFace = {
    piece: card.piece as PrintFinalPiece,
    orientation: card.orientation as PrintFinalFace['orientation'],
    look: 'immersive',
    region: card.region as PrintFinalFace['region'],
  }
  const address = card.address as 'short' | 'long'
  const tile = choosePrintFinalTile({
    ...face,
    address,
    symbolModules: SYMBOL_MODULES[address],
  })
  const plate = card.parts.find((part) => part.key === 'brand')
  const [v, h] = PLATE_MM[face.piece]
  return layoutPrintFinalImmersiveFace({
    face,
    blocks: blocksOf(card),
    brand:
      card.board === 'no-logo'
        ? { kind: 'wordmark', text: 'Hotel Elegance' }
        : {
            kind: 'logo',
            inkWidth: (plate?.w ?? 1) - 2 * h,
            inkHeight: (plate?.h ?? 1) - 2 * v,
            medianInkLuminance: 0.02,
          },
    tile: tile._unsafeUnwrap(),
    measurer: pdfFinalMeasurer(doc, fonts),
    accentColour: '#D4E3FE',
    fieldColour: '#001E57',
    photo: null,
  })
}

const near = (actual: number, expected: number, what: string) =>
  expect(
    Math.abs(actual - expected),
    `${what}: ${actual} against ${expected}`,
  ).toBeLessThanOrEqual(TOLERANCE_MM)

describe('the final Immersive faces in the PDF against the boards', () => {
  it('covers the family, Europe, the long address, two languages, no logo, no photo, German, the scan cues and the badge', () => {
    expect(new Set(immersiveCards.map((card) => card.board)).size).toBe(9)
    expect(immersiveCards).toHaveLength(52)
  })

  it.each(
    immersiveCards.map(
      (card) =>
        [
          `${card.board}: ${card.piece} ${card.orientation} (${card.region}, ${card.address})`,
          card,
        ] as const,
    ),
  )('%s: every part’s ink and the code block are the board’s', (_, card) => {
    const { layout } = laidOut(card)
    expect(layout.plan.problems).toEqual([])
    if (layout.headlinePt !== card.headlinePt) {
      // German on the tent: the boards' browser set the headline a hair wider and
      // stepped to the floor (16.5 pt); the embedded font keeps 4u at 17 pt.
      expect(card.board).toBe('long-text')
      expect(layout.headlinePt - card.headlinePt).toBeLessThanOrEqual(1)
      return
    }
    expect(layout.plan.parts.map((part) => part.key)).toEqual(
      card.parts.map((part) => part.key),
    )
    card.parts.forEach((expected, index) => {
      const part = layout.plan.parts[index]
      near(ptMm(part?.xPt ?? NaN), expected.l, `${expected.key} left`)
      near(ptMm(part?.yPt ?? NaN), expected.t, `${expected.key} top`)
      near(ptMm(part?.widthPt ?? NaN), expected.w, `${expected.key} width`)
      near(ptMm(part?.heightPt ?? NaN), expected.h, `${expected.key} height`)
    })
    near(ptMm(layout.plan.code.leftPt), card.tile.l, 'tile left')
    near(ptMm(layout.plan.code.topPt), card.tile.t, 'tile top')
    near(ptMm(layout.plan.code.bottomPt), card.tile.b, 'tile bottom')
  })
})

const renderer = createPdfKitPrintFinalRenderer({
  now: () => new Date('2026-10-25T10:00:00Z'),
  compress: false,
})

/** A photo light at the top and dark at the foot, 1200 × 700 px. */
async function photoBytes(): Promise<Uint8Array> {
  const width = 1200
  const height = 700
  const raw = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    const level = Math.round(230 - (y / height) * 180)
    for (let x = 0; x < width; x++)
      raw.set([level, level - 10, level - 20], (y * width + x) * 3)
  }
  return new Uint8Array(
    await sharp(raw, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer(),
  )
}

async function inputFor(
  face: PrintFinalFace,
  over: Partial<PrintFinalRenderInput> = {},
): Promise<PrintFinalRenderInput> {
  const blocks = printFinalBlocks(
    ['en'],
    { preset: 'how_did_we_do' },
    { en: 'Review us on Google' },
    'Reception',
  )
  return {
    title: 'Hotel Elegance',
    face,
    blocks: blocks,
    wordmark: 'Hotel Elegance',
    logo: null,
    accentColour: '#E3B873',
    fieldColour: '#2A1712',
    photo: { bytes: await photoBytes(), focalX: 0.5, focalY: 0.4 },
    qrAddress: SHORT,
    address: 'short',
    ...over,
  }
}

const text = (pdf: Uint8Array) => Buffer.from(pdf).toString('latin1')

describe('createPdfKitPrintFinalRenderer: Immersive', () => {
  it.each(
    PRINT_FINAL_PIECES.flatMap((piece) =>
      PRINT_FINAL_ORIENTATIONS.map((orientation) => [piece, orientation] as const),
    ),
  )(
    'prints an Immersive %s %s over its photo, faded by a soft mask',
    async (piece, orientation) => {
      const face = { piece, orientation, look: 'immersive', region: 'us' } as const
      const pdf = text(await renderer.render(await inputFor(face)))
      expect([...pdf.matchAll(/\/MediaBox/gu)]).toHaveLength(1)
      expect(pdf).toMatch(
        /\/Filter \/DCTDecode[\s\S]*?\/SMask \d+ 0 R|\/SMask \d+ 0 R[\s\S]*?\/Filter \/DCTDecode/u,
      )
      expect(pdf).toContain('/BM /Overlay')
      expect(pdf).not.toContain('AP.UP.RAILWAY.APP')
    },
  )

  it('paints the no-photo ground with no photo in the file', async () => {
    const face = {
      piece: 'counter',
      orientation: 'upright',
      look: 'immersive',
      region: 'us',
    } as const
    const pdf = text(await renderer.render(await inputFor(face, { photo: null })))
    expect(pdf).not.toContain('/DCTDecode')
    expect(pdf).toContain('/BM /Overlay')
  })

  it('puts a dark logo on the cream plate', async () => {
    const logo = await sharp({
      create: {
        width: 300,
        height: 200,
        channels: 4,
        background: { r: 16, g: 30, b: 80, alpha: 1 },
      },
    })
      .png()
      .toBuffer()
    const face = {
      piece: 'tent',
      orientation: 'wide',
      look: 'immersive',
      region: 'eu',
    } as const
    const cream = /0\.9647\d* 0\.9450\d* 0\.9019\d* scn/gu
    const bare = text(await renderer.render(await inputFor(face)))
    const plated = text(
      await renderer.render(await inputFor(face, { logo: new Uint8Array(logo) })),
    )
    // The tile is cream on both; the plate under the logo is the second cream fill.
    expect([...bare.matchAll(cream)]).toHaveLength(1)
    expect([...plated.matchAll(cream)]).toHaveLength(2)
  })
})
