// The Large card as the PDF lays it out and draws it, in the fonts it embeds:
// the round-3 boards' measures to half a point (spec-delta S3, "Measured"), the
// band kept on Immersive, the name under a logo, and the code drawn on the tile
// the address allows, its runs rebuilding the symbol at that tile's module.

import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import type { PrintKitRenderInput } from '../../application/ports/portal-print-kit-renderer.port'
import {
  defaultPrintKitOutput,
  printKitFaces,
  type PrintKitStyle,
  type PrintKitWords,
} from '#/shared/domain/portal-print-kit'
import { largeCardTile } from '#/shared/domain/portal-print-kit-card'
import type { CardLine } from '#/shared/domain/portal-print-kit-card-words'
import { CODE_TILE, TODAY_CODE_TILE } from '#/shared/domain/portal-print-kit-code-tile'
import { CODE_BLOCK, inToPt, ptToMm } from '#/shared/domain/portal-print-kit-measures'
import {
  IMMERSIVE_LOGO_PLATE,
  immersivePrintKitPalette,
  paperPrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import { PRINT_CHECK } from '#/shared/domain/portal-print-kit-sheets'
import { BAND } from '#/shared/domain/portal-print-kit-sizes'
import { createPdfKitPrintKitRenderer } from './pdfkit-print-kit-renderer'
import { layoutCardFace, type CardFaceLayout } from './print-kit-card-face'
import type { FaceLogo } from './print-kit-face-brand'
import { logoInk } from './print-kit-image'
import { openImage } from './print-kit-pdf-image'
import { PrintKitFonts } from './print-kit-pdf-text'
import { qrMatrix, type QrMatrix } from './print-kit-qr'

const TOKEN = 'pt_Q7mXc2LpV9sKt4Rw_Hc8vN3pL0qZr5TfY2bWm7XdJ9aKs4EuG1oPi6CnV8hRy3t'
/** Today's beta address: 159 characters, a version 9 symbol. */
const LONG = `https://web-closed-beta-v2.up.railway.app/p/${TOKEN}?accessArtifact=0b6d1c1e-52c4-4b34-9d63-6e3b4a1f9a10`
/** A short print address: version 3. */
const SHORT = 'HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R'
const OAKMERE = 'Oakmere by Larkspur Hotel Houston Hobby Airport'
const HARBORLINE = 'Harborline Inn Houston-Near The Galleria'

function newDocument() {
  const doc = new PDFDocument({ autoFirstPage: false, font: '', compress: false })
  doc.on('data', () => undefined)
  doc.addPage({ size: [612, 792], margin: 0 })
  return { doc, fonts: new PrintKitFonts(doc) }
}

/** A logo whose drawing fills it: Oakmere's tree-mark is 327 × 321, Harborline's badge 766 × 426. */
async function logoOf(
  doc: PDFKit.PDFDocument,
  size: Readonly<{ width: number; height: number }>,
  plate: string | null,
): Promise<FaceLogo> {
  const bytes = await sharp({
    create: { ...size, channels: 4, background: '#1D2B4F' },
  })
    .png()
    .toBuffer()
  const raw = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { image: openImage(doc, bytes), ink: logoInk(raw.data, raw.info), plate }
}

const faceOf = (languages: PrintKitWords['languages']) => {
  const [front] = printKitFaces(
    { piece: 'counter_card', languages, callToAction: 'rate' },
    { en: 'Reception', es: 'Recepción' },
    'Portal',
  )
  if (front === undefined) throw new Error('no face')
  return front
}

type Case = Readonly<{
  style: PrintKitStyle
  address: string
  languages?: PrintKitWords['languages']
  logo: 'oakmere' | 'harborline'
}>

async function layOut(options: Case): Promise<CardFaceLayout> {
  const { doc, fonts } = newDocument()
  const immersive = options.style === 'immersive'
  const qr = qrMatrix(options.address)
  const size =
    options.logo === 'oakmere' ? { width: 327, height: 321 } : { width: 766, height: 426 }
  return layoutCardFace(doc, fonts, faceOf(options.languages ?? ['en']), {
    size: 'large',
    style: options.style,
    paper: 'letter',
    palette: immersive
      ? immersivePrintKitPalette('#D4E3FE', '#001E57')
      : paperPrintKitPalette('#A8C6FE'),
    qr,
    tile: largeCardTile('letter', { text: options.address, symbolModules: qr.size }),
    wordmark: 'Oakmere',
    propertyName: options.logo === 'oakmere' ? OAKMERE : HARBORLINE,
    logo: await logoOf(doc, size, immersive ? IMMERSIVE_LOGO_PLATE : null),
  })
}

const names = (layout: CardFaceLayout) =>
  layout.plan.words.filter(
    (item): item is CardLine => item.kind === 'line' && item.role === 'name',
  )

describe('the Large card in the PDF’s fonts', () => {
  it('measures as imm-large-oakmere with a short address: band 93.6, gaps 23.2, code 251 to 403 pt', async () => {
    const layout = await layOut({ style: 'immersive', address: SHORT, logo: 'oakmere' })
    const { plan } = layout
    expect(plan.code.plan.tile).toBe(CODE_TILE.large.letter)
    expect(plan.bandPt ?? 0).toBeCloseTo(93.6, 0)
    expect(Math.abs(plan.gapPt - 23.2)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(plan.code.y - 251)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(plan.code.y + plan.code.plan.heightPt - 403)).toBeLessThanOrEqual(0.5)
    expect(names(layout)).toHaveLength(2)
  })

  it('measures as paper-large-harborline with a short address: two 48 pt gaps and no band', async () => {
    const { plan } = await layOut({ style: 'paper', address: SHORT, logo: 'harborline' })
    expect(plan.bandPt).toBeNull()
    expect(Math.abs(plan.gapPt - 48)).toBeLessThanOrEqual(0.5)
    // The outline sits on the 29 pt bottom margin.
    const foot = plan.code.y + plan.code.plan.heightPt + CODE_BLOCK.outlinePt
    expect(Math.abs(foot - (inToPt(6) - 29))).toBeLessThanOrEqual(0.5)
  })

  it.each([
    ['one language', ['en']],
    ['two languages', ['en', 'es']],
  ] as const)(
    'keeps the band with today’s long address on its 2 in tile, and the name with one language, %s on Immersive',
    async (_, languages) => {
      const layout = await layOut({
        style: 'immersive',
        address: LONG,
        languages,
        logo: 'oakmere',
      })
      expect(layout.plan.code.plan.tile).toBe(TODAY_CODE_TILE)
      expect(layout.plan.bandPt ?? 0).toBeGreaterThanOrEqual(BAND.large.minPt - 1e-9)
      if (languages.length === 1) expect(names(layout)).toHaveLength(2)
    },
  )

  it('prints the name under a logo on Paper too, broken after its hyphen as the board breaks it', async () => {
    const layout = await layOut({ style: 'paper', address: LONG, logo: 'harborline' })
    expect(names(layout).map((line) => line.text)).toEqual([
      'HARBORLINE INN HOUSTON-',
      'NEAR THE GALLERIA',
    ])
  })
})

const renderer = createPdfKitPrintKitRenderer({
  now: () => new Date('2026-10-23T12:00:00Z'),
  compress: false,
})

function inputFor(style: PrintKitStyle, address: string): PrintKitRenderInput {
  return {
    title: 'Reception counter card',
    piece: 'counter_card',
    style,
    paper: 'letter',
    size: 'large',
    output: defaultPrintKitOutput(style),
    faces: printKitFaces(
      { piece: 'counter_card', languages: ['en'], callToAction: 'rate' },
      { en: 'Reception' },
      'Reception',
    ),
    wordmark: 'Hotel Elegance',
    propertyName: 'Hotel Elegance',
    logo: null,
    photo: null,
    accentColour: '#D58400',
    fieldColour: '#232323',
    qrAddress: address,
  }
}

/** Every rectangle the print draws: x, y, width, height. */
async function drawnRects(input: PrintKitRenderInput): Promise<readonly number[][]> {
  const spy = vi.spyOn(PDFDocument.prototype, 'rect')
  try {
    await renderer.render(input)
    return spy.mock.calls.map((call) => [...call] as number[])
  } finally {
    spy.mockRestore()
  }
}

/** The symbol rebuilt from the runs one module tall, read from the first card's top-left run. */
function rebuild(rects: readonly number[][], module: number, size: number): QrMatrix {
  const runs = rects.filter(([, , , h]) => Math.abs((h ?? 0) - module) < 1e-6)
  const left = Math.min(...runs.map(([x]) => x ?? 0))
  const top = Math.min(...runs.map(([, y]) => y ?? 0))
  const dark = new Set<string>()
  for (const [x = 0, y = 0, width = 0] of runs) {
    const row = Math.round((y - top) / module)
    const column = Math.round((x - left) / module)
    // Only the first card: a run beyond the symbol belongs to the second.
    if (row >= size || column >= size) continue
    for (let step = 0; step < Math.round(width / module); step += 1) {
      dark.add(`${row}:${column + step}`)
    }
  }
  return { size, isDark: (row, column) => dark.has(`${row}:${column}`) }
}

describe('the Large card’s code, drawn', () => {
  it.each([
    ['immersive', SHORT, inToPt(1.75)],
    ['immersive', LONG, inToPt(2)],
    ['paper', SHORT, inToPt(1.75)],
    ['paper', LONG, inToPt(2)],
  ] as const)(
    'on %s rebuilds the symbol of %s at its tile’s module',
    async (style, address, tilePt) => {
      const expected = qrMatrix(address)
      const module = tilePt / (expected.size + 8)
      const rebuilt = rebuild(
        await drawnRects(inputFor(style, address)),
        module,
        expected.size,
      )
      for (let row = 0; row < expected.size; row += 1) {
        for (let column = 0; column < expected.size; column += 1) {
          expect(rebuilt.isDark(row, column), `${row}:${column}`).toBe(
            expected.isDark(row, column),
          )
        }
      }
      // At or over the floor on the 1.75 in tile; today's beta address, version 9, at 2 in.
      expect(ptToMm(module)).toBeCloseTo(address === SHORT ? 1.201 : 0.833, 2)
    },
  )

  it.each([
    [SHORT, inToPt(1.75)],
    [LONG, inToPt(2)],
  ] as const)(
    'draws the Letter sheet’s print check as wide as the tile, for %s',
    async (address, tilePt) => {
      const rects = await drawnRects(inputFor('paper', address))
      const bar = rects.find(([, , , h]) => h === PRINT_CHECK.bar.heightPt)
      expect(bar?.[2]).toBeCloseTo(tilePt, 6)
    },
  )
})
