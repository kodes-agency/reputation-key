import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  printKitFaces,
  type PrintFace,
  type PrintKitChoice,
} from '#/shared/domain/portal-print-kit'
import {
  CARD_GRID,
  CODE_BLOCK,
  FIT,
  MARGIN,
  TENT_FACE_GRID,
  TYPE_FLOOR_PT,
  inToPt,
  mmToPt,
  ptToIn,
} from '#/shared/domain/portal-print-kit-measures'
import { paperPrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import {
  PANEL_SIZE_PT,
  type PanelGeometry,
} from '#/shared/domain/portal-print-kit-sheets'
import type { FaceLogo } from './print-kit-face-brand'
import { logoInk } from './print-kit-image'
import { layoutPaperFace, type PaperFaceLayout } from './print-kit-paper-face'
import { openImage } from './print-kit-pdf-image'
import { PrintKitFonts } from './print-kit-pdf-text'
import { qrMatrix } from './print-kit-qr'

const QR = qrMatrix('https://app.reputationkey.app/p/pt_AbCdEfGhIjKlMnOp_AbCdEf')
const POOL = { en: 'Pool & Terrace', es: 'Piscina y terraza', bg: 'Басейн и тераса' }

function newDocument() {
  const doc = new PDFDocument({ autoFirstPage: false, font: '', compress: false })
  doc.on('data', () => undefined)
  doc.addPage({ size: [612, 792], margin: 0 })
  return { doc, fonts: new PrintKitFonts(doc) }
}

const faceOf = (
  choice: Omit<PrintKitChoice, 'callToAction'> & { callToAction?: 'rate' | 'tell' },
  titles: Readonly<Record<string, string>> = POOL,
): PrintFace => {
  const [front] = printKitFaces({ callToAction: 'rate', ...choice }, titles, 'Portal')
  if (front === undefined) throw new Error('no face')
  return front
}

/** A logo file like the boards': a dark drawing under a transparent top edge of `edge` rows. */
async function logoFile(colour: string, edge = 20): Promise<Buffer> {
  const drawing = await sharp({
    create: { width: 900, height: 220 - edge, channels: 4, background: colour },
  })
    .png()
    .toBuffer()
  return sharp({
    create: {
      width: 900,
      height: 220,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: drawing, top: edge, left: 0 }])
    .png()
    .toBuffer()
}

async function faceLogo(doc: PDFKit.PDFDocument, colour = '#1A1A1A'): Promise<FaceLogo> {
  const bytes = await logoFile(colour)
  const raw = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { image: openImage(doc, bytes), ink: logoInk(raw.data, raw.info), plate: null }
}

type Layout = Readonly<{ layout: PaperFaceLayout; geometry: PanelGeometry }>

async function layOut(
  face: PrintFace,
  geometry: PanelGeometry,
  options: Readonly<{ logo?: boolean; wordmark?: string }> = {},
): Promise<Layout> {
  const { doc, fonts } = newDocument()
  const palette = paperPrintKitPalette('#EAD6A8')
  const logo = options.logo === true ? await faceLogo(doc) : null
  const layout = layoutPaperFace(
    doc,
    fonts,
    face,
    {
      palette,
      qr: QR,
      brand: { wordmark: options.wordmark ?? 'Avela', colour: palette.ink, logo },
    },
    geometry,
  )
  return { layout, geometry }
}

/** Where the face's ink is: the brand's cap line or drawing, the words, and the tile's outline. */
function inkOf({ layout }: Layout) {
  const { brand, stack, code } = layout
  const lines = stack.stack.items.map((item) => {
    const left =
      stack.align === 'centre' ? stack.x + (stack.widthPt - item.widthPt) / 2 : stack.x
    return { left, right: left + item.widthPt }
  })
  const outline = CODE_BLOCK.outlinePt
  return {
    top: brand.y + brand.plan.inkTopPt,
    bottom: code.y + code.plan.heightPt + outline,
    left: Math.min(
      brand.x + brand.plan.inkLeftPt,
      code.x - outline,
      ...lines.map((l) => l.left),
    ),
    right: Math.max(
      brand.x + brand.plan.widthPt,
      code.x + CODE_BLOCK.tilePt + outline,
      ...lines.map((l) => l.right),
    ),
  }
}

/** The two flexible gaps of a card: brand to words, and words to code. */
function cardGaps({ layout }: Layout) {
  const { brand, stack, code } = layout
  return {
    above: stack.y - (brand.y + brand.plan.heightPt),
    below: code.y - (stack.y + stack.stack.heightPt),
  }
}

const twoLanguages = faceOf({ piece: 'counter_card', languages: ['en', 'es'] })

/** Titles near the 120 characters a Portal's title may have: more lines than any face has room for. */
const LONGEST = {
  en: 'The rooftop pool, sun terrace and cocktail bar overlooking the old harbour and the Bellevue gardens',
  es: 'La piscina de la azotea, la terraza solar y el bar de cócteles con vistas al puerto viejo y los jardines',
}

describe('the Paper counter card', () => {
  it.each(['card4x6', 'cardA6'] as const)(
    'keeps equal top and bottom margins to ink on %s: the cap line and the tile outline',
    async (geometry) => {
      const placed = await layOut(twoLanguages, geometry)
      const grid = CARD_GRID.paper[geometry === 'card4x6' ? 'letter' : 'a4']
      const ink = inkOf(placed)
      expect(ink.top).toBeCloseTo(grid.marginPt, 6)
      expect(PANEL_SIZE_PT[geometry].heightPt - ink.bottom).toBeCloseTo(grid.marginPt, 6)
      expect(ink.left).toBeGreaterThanOrEqual(grid.sidePt)
      expect(PANEL_SIZE_PT[geometry].widthPt - ink.right).toBeGreaterThanOrEqual(
        grid.sidePt,
      )
    },
  )

  it('centres the code block at 1.00 – 3.00 in, with the board’s 3.14 in top on a two-language 4 × 6 in card', async () => {
    const { layout } = await layOut(twoLanguages, 'card4x6')
    expect(ptToIn(layout.code.x)).toBeCloseTo(1, 6)
    expect(ptToIn(layout.code.y)).toBeCloseTo(3.14, 2)
  })

  it('shares the spare height equally above and below the words, as the boards measure it', async () => {
    const two = cardGaps(await layOut(twoLanguages, 'card4x6'))
    expect(two.above).toBeCloseTo(two.below, 6)
    expect(ptToIn(two.above)).toBeCloseTo(0.47, 1)
    const one = cardGaps(
      await layOut(
        faceOf(
          { piece: 'counter_card', languages: ['en'], callToAction: 'tell' },
          { en: 'Chair 3' },
        ),
        'card4x6',
        { wordmark: 'Kadife Barbers' },
      ),
    )
    expect(one.above).toBeCloseTo(one.below, 6)
    expect(ptToIn(one.above)).toBeCloseTo(0.72, 1)
  })

  it('sets the place label as the largest type: 24 pt with two languages, 32 pt with one', async () => {
    const two = await layOut(twoLanguages, 'cardA6')
    expect(two.layout.stack.stack.first?.style.size).toBe(24)
    const one = await layOut(
      faceOf({ piece: 'counter_card', languages: ['en'] }),
      'cardA6',
    )
    expect(one.layout.stack.stack.first?.style.size).toBe(32)
  })

  it('steps the type down for words that do not fit, and never sets a guest’s line under 9 pt', async () => {
    const long = faceOf(
      { piece: 'counter_card', languages: ['en', 'bg'] },
      {
        en: 'Spa & Wellness Centre Reception, Lobby Bar and the Garden Terrace by the Pool',
        bg: 'Спа и уелнес център, рецепция, лоби бар и градинската тераса до басейна',
      },
    )
    const placed = await layOut(long, 'cardA6')
    const { layout } = placed
    // Fit step (c) first, then the place label shrinks: the words keep clear of the code.
    expect(layout.stack.stack.first?.style.size).toBeLessThan(22)
    expect(cardGaps(placed).below).toBeGreaterThanOrEqual(FIT.paperGapPt.code - 1e-6)
    const sizes = layout.stack.stack.items.flatMap((item) =>
      item.kind === 'line' ? [item.style.size] : [],
    )
    expect(sizes).toContain(17)
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(TYPE_FLOOR_PT.read)
  })

  it.each([
    ['cardA6', ['en', 'es']],
    ['card4x6', ['en', 'es']],
    ['card4x6', ['en']],
  ] as const)(
    'shrinks a place label too long for %s in %j before its words reach the code block',
    async (geometry, languages) => {
      const face = faceOf(
        { piece: 'counter_card', languages, callToAction: 'tell' },
        LONGEST,
      )
      const placed = await layOut(face, geometry, {
        wordmark: 'Grand Hotel Bellevue Palace',
      })
      const gaps = cardGaps(placed)
      expect(gaps.above).toBeGreaterThanOrEqual(FIT.paperGapPt.brand - 1e-6)
      expect(gaps.below).toBeGreaterThanOrEqual(FIT.paperGapPt.code - 1e-6)
      const sizes = placed.layout.stack.stack.items.flatMap((item) =>
        item.kind === 'line' ? [item.style.size] : [],
      )
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(TYPE_FLOOR_PT.read)
    },
  )

  it('measures the top margin to a logo’s drawing, not to its transparent edge', async () => {
    const placed = await layOut(twoLanguages, 'card4x6', { logo: true })
    expect(placed.layout.brand.plan.inkTopPt).toBeGreaterThan(0)
    expect(inkOf(placed).top).toBeCloseTo(CARD_GRID.paper.letter.marginPt, 6)
  })
})

const tentFace = faceOf({ piece: 'table_tent', languages: ['en', 'es'] })

describe('the Paper tent face', () => {
  it.each(['tentFaceLetter', 'tentFaceA5'] as const)(
    'keeps the same margin to ink at the fold as at the sheet edge on %s, and clears the fold',
    async (geometry) => {
      const placed = await layOut(tentFace, geometry, { logo: true })
      const grid = TENT_FACE_GRID[geometry === 'tentFaceLetter' ? 'letter' : 'a4']
      const ink = inkOf(placed)
      const atEdge = grid.heightPt - ink.bottom
      expect(ink.top).toBeCloseTo(atEdge, 6)
      expect(ink.top).toBeGreaterThanOrEqual(grid.foldClearancePt)
      expect(ink.left).toBeCloseTo(grid.sidePt, 6)
      expect(grid.widthPt - ink.right).toBeCloseTo(
        grid.sidePt - MARGIN.optical.outlinePt,
        6,
      )
    },
  )

  it('splits the Letter face’s spare height in three gaps of about 0.79 in, as the board does', async () => {
    const { layout } = await layOut(tentFace, 'tentFaceLetter', { logo: true })
    const aboveBrand = layout.brand.y
    const aboveRow = layout.stack.y - (layout.brand.y + layout.brand.plan.heightPt)
    expect(aboveRow).toBeCloseTo(aboveBrand, 6)
    expect(ptToIn(aboveBrand)).toBeCloseTo(0.79, 1)
  })

  it('puts the tile’s top on the place label’s cap line, beside the words', async () => {
    const { layout } = await layOut(tentFace, 'tentFaceLetter')
    const offset = layout.code.y - layout.stack.y
    // The board's 2.45 mm, from the font's own cap height and line box.
    expect(offset).toBeGreaterThan(mmToPt(2))
    expect(offset).toBeLessThan(mmToPt(2.6))
    expect(layout.stack.align).toBe('start')
    expect(layout.stack.x + layout.stack.widthPt + mmToPt(12)).toBeCloseTo(
      layout.code.x,
      6,
    )
  })

  it.each(['tentFaceLetter', 'tentFaceA5'] as const)(
    'shrinks a place label too long for %s before the words cross the fold clearance',
    async (geometry) => {
      const face = faceOf({ piece: 'table_tent', languages: ['en', 'es'] }, LONGEST)
      const { layout } = await layOut(face, geometry, { logo: true })
      const grid = TENT_FACE_GRID[geometry === 'tentFaceLetter' ? 'letter' : 'a4']
      expect(layout.brand.y).toBeGreaterThanOrEqual(grid.foldClearancePt - 1e-6)
      const wordsBottom = layout.stack.y + layout.stack.stack.heightPt
      expect(wordsBottom).toBeLessThanOrEqual(grid.heightPt - grid.foldClearancePt + 1e-6)
      expect(layout.stack.stack.first?.style.size).toBeLessThan(40)
      // The tile still sits on the shrunk place label's cap line.
      expect(layout.code.y - layout.stack.y).toBeLessThan(mmToPt(2.45))
    },
  )

  it('sets the tent type scale: a 40 pt place label', async () => {
    const { layout } = await layOut(tentFace, 'tentFaceA5')
    expect(layout.stack.stack.first?.style.size).toBe(40)
    expect(layout.code.x).toBeCloseTo(
      PANEL_SIZE_PT.tentFaceA5.widthPt - mmToPt(10) - inToPt(2),
      6,
    )
  })
})
