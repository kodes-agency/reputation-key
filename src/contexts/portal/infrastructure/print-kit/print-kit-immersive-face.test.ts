import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  printKitFaces,
  type PrintFace,
  type PrintKitChoice,
} from '#/shared/domain/portal-print-kit'
import {
  CODE_BLOCK,
  FIT,
  IMMERSIVE_TENT_GRID,
  MARGIN,
  TYPE_FLOOR_PT,
  WINDOW,
  inToPt,
  ptToIn,
  ptToMm,
} from '#/shared/domain/portal-print-kit-measures'
import { immersivePrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import {
  PANEL_SIZE_PT,
  type PanelGeometry,
} from '#/shared/domain/portal-print-kit-sheets'
import type { FaceLogo } from './print-kit-face-brand'
import { logoInk } from './print-kit-image'
import { layoutImmersiveFace, type ImmersiveFaceLayout } from './print-kit-immersive-face'
import { openImage } from './print-kit-pdf-image'
import { PrintKitFonts } from './print-kit-pdf-text'
import { qrMatrix } from './print-kit-qr'

const QR = qrMatrix('https://app.reputationkey.app/p/pt_AbCdEfGhIjKlMnOp_AbCdEf')
const POOL = { en: 'Pool & Terrace', es: 'Piscina y terraza', bg: 'Басейн и тераса' }
const TRATTORIA = { it: 'Sala', en: 'Dining room' }

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

/** A light logo like the board's: a cream drawing under 1.2 mm of transparent edge at 11.6 mm tall. */
async function lightLogo(doc: PDFKit.PDFDocument): Promise<FaceLogo> {
  const edge = 23
  const drawing = await sharp({
    create: { width: 900, height: 220 - edge, channels: 4, background: '#F6F1E8' },
  })
    .png()
    .toBuffer()
  const bytes = await sharp({
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
  const raw = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { image: openImage(doc, bytes), ink: logoInk(raw.data, raw.info), plate: null }
}

async function layOut(
  face: PrintFace,
  geometry: PanelGeometry,
  options: Readonly<{ logo?: boolean; wordmark?: string; accent?: string }> = {},
): Promise<ImmersiveFaceLayout> {
  const { doc, fonts } = newDocument()
  const palette = immersivePrintKitPalette(options.accent ?? '#EAD6A8', null)
  const logo = options.logo === true ? await lightLogo(doc) : null
  return layoutImmersiveFace(
    doc,
    fonts,
    face,
    {
      palette,
      qr: QR,
      brand: { wordmark: options.wordmark ?? 'Avela', colour: palette.headline, logo },
    },
    geometry,
  )
}

const pictureMm = (layout: ImmersiveFaceLayout) =>
  ptToMm(layout.window?.picture.heightPt ?? 0)

describe('the Immersive counter card', () => {
  it('measures as the 4 × 6 in two-language board: the window shrinks to 0.61 in (fit step a)', async () => {
    const layout = await layOut(
      faceOf({ piece: 'counter_card', languages: ['en', 'es'] }),
      'card4x6',
    )
    expect(pictureMm(layout)).toBeCloseTo(15.4, 0)
    expect(ptToMm(layout.window?.picture.widthPt ?? 0)).toBeCloseTo(84.4, 1)
    expect(ptToIn(layout.stack.y)).toBeCloseTo(1.41, 1)
    expect(layout.stack.stack.first?.style.size).toBe(24)
    expect(ptToIn(layout.code.y)).toBeCloseTo(3.15, 1)
  })

  it('measures as the barber board: one language leaves the monogram window 1.11 in, under its cap', async () => {
    const layout = await layOut(
      faceOf(
        { piece: 'counter_card', languages: ['en'], callToAction: 'tell' },
        { en: 'Chair 3' },
      ),
      'card4x6',
      { wordmark: 'Kadife Barbers', accent: '#0F8B8D' },
    )
    expect(ptToIn(layout.window?.picture.heightPt ?? 0)).toBeCloseTo(1.11, 1)
    expect(layout.window?.picture.heightPt ?? 0).toBeLessThan(WINDOW.maxPt)
    expect(ptToIn(layout.stack.y)).toBeCloseTo(1.91, 1)
    expect(layout.stack.stack.first?.style.size).toBe(32)
  })

  it('measures as the trattoria board, Italian leading', async () => {
    const layout = await layOut(
      faceOf({ piece: 'counter_card', languages: ['it', 'en'] }, TRATTORIA),
      'card4x6',
      { wordmark: 'Trattoria Nonna', accent: '#C8102E' },
    )
    expect(pictureMm(layout)).toBeCloseTo(15.4, 0)
  })

  it('takes fit steps (a) to (c) on the A6 two-language card: a 15 pt wordmark, 22 pt place label, 14.4 mm photo', async () => {
    const layout = await layOut(
      faceOf({ piece: 'counter_card', languages: ['en', 'bg'] }),
      'cardA6',
    )
    expect(pictureMm(layout)).toBeCloseTo(14.4, 0)
    expect(layout.stack.stack.first?.style.size).toBe(22)
    expect(layout.brand.plan.kind === 'wordmark' && layout.brand.plan.style.size).toBe(15)
    expect(ptToMm(layout.code.y)).toBeCloseTo(75.7, 0)
  })

  it.each(['card4x6', 'cardA6'] as const)(
    'keeps equal optical margins on the %s: the cap line and the bar’s bottom edge',
    async (geometry) => {
      const layout = await layOut(
        faceOf({ piece: 'counter_card', languages: ['en', 'es'] }),
        geometry,
      )
      const { heightPt, widthPt } = PANEL_SIZE_PT[geometry]
      const margin = geometry === 'card4x6' ? MARGIN.letterPt : MARGIN.a4Pt
      expect(layout.brand.y + layout.brand.plan.inkTopPt).toBeCloseTo(margin, 6)
      expect(heightPt - (layout.code.y + layout.code.plan.heightPt)).toBeCloseTo(
        margin,
        6,
      )
      expect(layout.code.x + CODE_BLOCK.tilePt / 2).toBeCloseTo(widthPt / 2, 6)
      expect(layout.ridgePt).toBeNull()
    },
  )

  it('keeps the gaps at their minimum or more and nothing a guest reads under 9 pt', async () => {
    for (const geometry of ['card4x6', 'cardA6'] as const) {
      const layout = await layOut(
        faceOf({ piece: 'counter_card', languages: ['en', 'bg'] }),
        geometry,
      )
      const window = layout.window
      if (window === null) throw new Error('expected a window')
      expect(
        window.y - (layout.brand.y + layout.brand.plan.heightPt),
      ).toBeGreaterThanOrEqual(FIT.gapPt.floor - 1e-6)
      expect(layout.stack.y - (window.y + window.heightPt)).toBeGreaterThanOrEqual(
        FIT.gapPt.floor - 1e-6,
      )
      expect(
        layout.code.y - (layout.stack.y + layout.stack.stack.heightPt),
      ).toBeGreaterThanOrEqual(FIT.gapPt.floor - 1e-6)
      for (const item of layout.stack.stack.items) {
        if (item.kind === 'line')
          expect(item.style.size).toBeGreaterThanOrEqual(TYPE_FLOOR_PT.read)
      }
    }
  })

  it('drops the window before the words reach the code', async () => {
    const long = 'The terrace bar by the pool and the garden restaurant on the lower deck'
    const layout = await layOut(
      faceOf(
        { piece: 'counter_card', languages: ['en', 'bg'] },
        { en: long, bg: 'Басейн' },
      ),
      'cardA6',
    )
    expect(layout.window).toBeNull()
    expect(
      layout.code.y - (layout.stack.y + layout.stack.stack.heightPt),
    ).toBeGreaterThanOrEqual(FIT.gapPt.floor - 1e-6)
  })

  it('shrinks a place label too long for any step, the last resort, before the words reach the code', async () => {
    const longest =
      'The terrace bar by the pool, the garden restaurant on the lower deck and the spa lounge upstairs'
    const layout = await layOut(
      faceOf(
        { piece: 'counter_card', languages: ['en', 'bg'] },
        { en: longest, bg: 'Басейн' },
      ),
      'cardA6',
    )
    expect(layout.window).toBeNull()
    expect(layout.stack.stack.first?.style.size ?? 99).toBeLessThan(22)
    expect(
      layout.code.y - (layout.stack.y + layout.stack.stack.heightPt),
    ).toBeGreaterThanOrEqual(FIT.gapPt.floor - 1e-6)
  })
})

describe('the Immersive tent panel', () => {
  it('measures as the tent board: the logo 0.4 in under the ridge band and a 0.58 in photo', async () => {
    const layout = await layOut(
      faceOf({ piece: 'table_tent', languages: ['en'] }),
      'tentPanel4x6',
      {
        logo: true,
      },
    )
    const grid = IMMERSIVE_TENT_GRID.letter
    expect(layout.ridgePt).toBe(grid.ridgePt)
    expect(ptToIn(layout.brand.y + layout.brand.plan.inkTopPt)).toBeCloseTo(0.58, 2)
    expect(ptToIn(layout.window?.picture.heightPt ?? 0)).toBeCloseTo(0.58, 1)
    expect(ptToIn(layout.code.y)).toBeCloseTo(3.2, 1)
    expect(layout.stack.stack.first?.style.size).toBe(32)
  })

  it.each(['tentPanel4x6', 'tentPanelA6'] as const)(
    'prints a two-language %s without a window (decision D4)',
    async (geometry) => {
      const layout = await layOut(
        faceOf({ piece: 'table_tent', languages: ['en', 'es'] }),
        geometry,
      )
      expect(layout.window).toBeNull()
      const { heightPt } = PANEL_SIZE_PT[geometry]
      const margin = geometry === 'tentPanel4x6' ? MARGIN.letterPt : MARGIN.a4Pt
      expect(heightPt - (layout.code.y + layout.code.plan.heightPt)).toBeCloseTo(
        margin,
        6,
      )
    },
  )

  it('measures the A6 panel’s top margin from its 4.5 mm band', async () => {
    const layout = await layOut(
      faceOf({ piece: 'table_tent', languages: ['en'] }),
      'tentPanelA6',
    )
    expect(ptToMm(layout.brand.y + layout.brand.plan.inkTopPt)).toBeCloseTo(14.5, 6)
    expect(layout.window?.picture.heightPt ?? 0).toBeGreaterThanOrEqual(inToPt(0.55))
    expect(layout.window?.picture.heightPt ?? 0).toBeLessThanOrEqual(WINDOW.tentMaxPt)
  })
})

describe('layoutImmersiveFace', () => {
  it('refuses a Paper tent face', async () => {
    await expect(
      layOut(faceOf({ piece: 'table_tent', languages: ['en'] }), 'tentFaceLetter'),
    ).rejects.toThrow(/tentFaceLetter/u)
  })
})
