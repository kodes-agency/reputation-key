// The small table tent's face as the PDF lays it out and draws it, in the fonts
// it embeds: the 5 × 3.5 in face with its panel on Immersive alone, one
// language a face with no name line (D12), the code on Table's tile, and the
// photo or monogram run into the bleed of the panel and nowhere else.

import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import {
  printKitFaces,
  type PrintFace,
  type PrintKitStyle,
} from '#/shared/domain/portal-print-kit'
import { CODE_TILE } from '#/shared/domain/portal-print-kit-code-tile'
import { inToPt } from '#/shared/domain/portal-print-kit-measures'
import {
  immersivePrintKitPalette,
  paperPrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import { newDocument, POOL } from './__fixtures__/print-kit-face-fixtures'
import type { CardFaceArt } from './print-kit-card-face'
import { openImage } from './print-kit-pdf-image'
import { qrMatrix } from './print-kit-qr'
import { drawTentFace, layoutTentFace, type TentFaceLayout } from './print-kit-tent-face'

/** A short print address on the print host: version 3. */
const SHORT = 'HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R'

/** The two faces of an English and Spanish tent. */
const FACES = printKitFaces(
  { piece: 'table_tent', languages: ['en', 'es'], callToAction: 'rate' },
  POOL,
  'Portal',
)
const faceOn = (side: PrintFace['side']): PrintFace => {
  const face = FACES.find((candidate) => candidate.side === side)
  if (face === undefined) throw new Error(`no ${side} face`)
  return face
}

function artOf(style: PrintKitStyle): CardFaceArt {
  return {
    size: 'table',
    style,
    paper: 'letter',
    palette:
      style === 'immersive'
        ? immersivePrintKitPalette('#D4E3FE', '#001E57')
        : paperPrintKitPalette('#A8C6FE'),
    qr: qrMatrix(SHORT),
    tile: CODE_TILE.table.letter,
    wordmark: 'Oakmere',
    propertyName: 'Oakmere by Larkspur Hotel Houston Hobby Airport',
    logo: null,
  }
}

function layOut(style: PrintKitStyle, face: PrintFace = faceOn('front')) {
  const { doc, fonts } = newDocument()
  return { doc, fonts, layout: layoutTentFace(doc, fonts, face, artOf(style)) }
}

const localesOf = (layout: TentFaceLayout) => [
  ...new Set(
    layout.plan.words.flatMap((item) =>
      item.kind === 'line' && item.locale !== null ? [item.locale] : [],
    ),
  ),
]

describe('the small tent’s plan in the PDF’s fonts', () => {
  it('is a 5 × 3.5 in face with Table’s tile, and a 1.2 in panel on Immersive only', () => {
    const immersive = layOut('immersive').layout.plan
    const paper = layOut('paper').layout.plan

    expect(immersive.widthPt).toBeCloseTo(inToPt(5), 6)
    expect(immersive.heightPt).toBeCloseTo(inToPt(3.5), 6)
    expect(immersive.panelPt).toBeCloseTo(inToPt(1.2), 6)
    expect(immersive.code.plan.tile).toBe(CODE_TILE.table.letter)
    expect(paper.panelPt).toBeNull()
    expect(paper.code.plan.tile).toBe(CODE_TILE.table.letter)
  })

  it('keeps the lead language a face alone: English on the front, Spanish on the back', () => {
    expect(localesOf(layOut('paper', faceOn('front')).layout)).toEqual(['en'])
    expect(localesOf(layOut('paper', faceOn('back')).layout)).toEqual(['es'])
  })

  it('sets no name under the brand, which carries it at this size', () => {
    const { layout } = layOut('immersive')

    const roles = layout.plan.words.flatMap((item) =>
      item.kind === 'line' ? [item.role] : [],
    )

    expect(roles).not.toContain('name')
    expect(roles.length).toBeGreaterThan(0)
  })

  it('keeps every word inside its column', () => {
    const { layout } = layOut('immersive')
    const { column } = layout.plan

    for (const item of layout.plan.words) {
      expect(item.widthPt).toBeLessThanOrEqual(column.widthPt + 0.01)
    }
  })
})

const BLEED = { topPt: 3, rightPt: 3, bottomPt: 3, leftPt: 3 } as const

/** The rectangles a face's drawing makes, by their left, top, width and height. */
const rectsOf = (rect: Readonly<{ mock: { calls: readonly (readonly unknown[])[] } }>) =>
  rect.mock.calls.map((call) => call.slice(0, 4).map(Number))

async function jpeg(doc: PDFKit.PDFDocument) {
  const bytes = await sharp({
    create: { width: 90, height: 252, channels: 3, background: '#778899' },
  })
    .jpeg()
    .toBuffer()
  return openImage(doc, bytes)
}

describe('drawing the small tent’s face', () => {
  it('on Immersive runs the panel into the bleed on the left, top and foot, and draws the photo in it', async () => {
    const { doc, fonts, layout } = layOut('immersive')
    const rect = vi.spyOn(doc, 'rect')
    const image = vi.spyOn(doc, 'image')
    const panelPt = layout.plan.panelPt ?? 0

    drawTentFace(doc, fonts, layout, { photo: await jpeg(doc), letter: 'O' }, BLEED)

    expect(rectsOf(rect)).toContainEqual([
      -BLEED.leftPt,
      -BLEED.topPt,
      panelPt + BLEED.leftPt,
      layout.plan.heightPt + BLEED.topPt + BLEED.bottomPt,
    ])
    expect(image).toHaveBeenCalledTimes(1)
  })

  it('on Immersive with no photo sets the monogram on the panel’s ground instead', () => {
    const { doc, fonts, layout } = layOut('immersive')
    const image = vi.spyOn(doc, 'image')
    const text = vi.spyOn(doc, 'text')

    drawTentFace(doc, fonts, layout, { photo: null, letter: 'O' }, BLEED)

    expect(image).not.toHaveBeenCalled()
    expect(text.mock.calls.map((call) => call[0])).toContain('O')
  })

  it('on Paper draws no field and no panel, even when handed a photo', async () => {
    const { doc, fonts, layout } = layOut('paper')
    const image = vi.spyOn(doc, 'image')

    drawTentFace(
      doc,
      fonts,
      layout,
      { photo: await jpeg(doc), letter: 'O' },
      { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
    )

    expect(image).not.toHaveBeenCalled()
  })
})
