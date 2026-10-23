import PDFDocument from 'pdfkit'
import { describe, expect, it, vi } from 'vitest'
import { GUEST_LOCALES, type GuestLocale } from '#/shared/domain/guest-locale'
import { PRINT_KIT_SCAN_CUE } from '#/shared/domain/portal-print-kit'
import {
  CAMERA_ICON,
  SCAN_CUE_WIDTH_EM,
  codeBlockColours,
  cueLinesFor,
  estimatedCueWidthPt,
  planCodeBlock,
} from '#/shared/domain/portal-print-kit-code-block'
import {
  CODE_BLOCK,
  CODE_SYMBOL_MIN_PT,
  codeSymbolPt,
  cueRoomPt,
  inToPt,
  mmToPt,
  ptToIn,
} from '#/shared/domain/portal-print-kit-measures'
import { printKitPalette } from '#/shared/domain/portal-print-kit-palette'
import { drawCodeBlock, planPdfCodeBlock } from './print-kit-code-block'
import { measureLine, PrintKitFonts } from './print-kit-pdf-text'
import { qrDarkRuns, qrMatrix } from './print-kit-qr'

const ADDRESS =
  'https://app.reputationkey.app/p/pt_AbCdEfGhIjKlMnOp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe?accessArtifact=0b6d1c1e-52c4-4b34-9d63-6e3b4a1f9a10'
const QR = qrMatrix(ADDRESS)

function newDocument() {
  const doc = new PDFDocument({ autoFirstPage: false, font: '', compress: false })
  doc.on('data', () => undefined)
  doc.addPage({ size: [400, 400], margin: 0 })
  return { doc, fonts: new PrintKitFonts(doc) }
}

const cueStyle = (size: number) => ({
  face: 'bodyStrong' as const,
  size,
  spacing: 0,
  colour: '#000000',
  opacity: 1,
})

describe('the cue widths the preview relies on', () => {
  it.each(GUEST_LOCALES)('match the PDF’s measure of the %s cue', (locale) => {
    const { doc, fonts } = newDocument()
    const emWidth =
      measureLine(doc, fonts, PRINT_KIT_SCAN_CUE[locale], cueStyle(1000)) / 1000
    expect(SCAN_CUE_WIDTH_EM[locale]).toBeCloseTo(emWidth, 3)
  })

  it('plan the block as the PDF does, for every language alone and under every lead', () => {
    const { doc, fonts } = newDocument()
    const lists: GuestLocale[][] = GUEST_LOCALES.flatMap((locale) => [
      [locale],
      [locale, 'en'],
    ])
    for (const locales of lists) {
      const cues = cueLinesFor(locales)
      expect(planPdfCodeBlock(doc, fonts, cues), locales.join('+')).toEqual(
        planCodeBlock(cues, estimatedCueWidthPt),
      )
    }
  })
})

describe('the cue in every language', () => {
  const measured = (locale: GuestLocale, size: number) => {
    const { doc, fonts } = newDocument()
    return measureLine(doc, fonts, PRINT_KIT_SCAN_CUE[locale], {
      ...cueStyle(size),
      spacing: size * CODE_BLOCK.cueTrackingEm,
    })
  }

  it.each(['en', 'es', 'bg', 'it', 'de'] as const)(
    'fits beside the pictogram at 9 pt in %s, with a second language below it',
    (locale) => {
      expect(measured(locale, 9)).toBeLessThanOrEqual(cueRoomPt('two'))
    },
  )

  it('is longest in French, which gives the pictogram up its place beside a second line', () => {
    const widths = GUEST_LOCALES.map((locale) => [locale, measured(locale, 9)] as const)
    expect(widths.reduce((a, b) => (b[1] > a[1] ? b : a))[0]).toBe('fr')
    const { doc, fonts } = newDocument()
    const alone = planPdfCodeBlock(doc, fonts, cueLinesFor(['fr']))
    const withSecond = planPdfCodeBlock(doc, fonts, cueLinesFor(['fr', 'en']))
    // Alone it is stepped down to 9 pt and just fits beside the pictogram.
    expect(alone).toMatchObject({ cuePt: 9, iconAbove: false })
    // With a second line the room is 0.01 in less, and the fit rule moves the pictogram above.
    expect(withSecond).toMatchObject({ cuePt: 9, iconAbove: true })
    expect(ptToIn(withSecond.barPt)).toBeCloseTo(0.53, 10)
  })

  it.each(GUEST_LOCALES)('never needs a size under 9 pt in %s', (locale) => {
    const { doc, fonts } = newDocument()
    for (const locales of [[locale], [locale, 'en' as const]]) {
      const plan = planPdfCodeBlock(doc, fonts, cueLinesFor(locales))
      expect(plan.cuePt).toBeGreaterThanOrEqual(9)
      // Even above, the line has the room: the whole bar less its padding.
      expect(measured(locale, plan.cuePt)).toBeLessThanOrEqual(
        CODE_BLOCK.tilePt - 2 * CODE_BLOCK.barPaddingPt,
      )
    }
  })
})

type Draw = Readonly<{
  rects: readonly number[][]
  rounded: readonly number[][]
  texts: readonly { text: string; x: number; y: number }[]
  paths: readonly string[]
  circles: readonly number[][]
  plan: ReturnType<typeof planPdfCodeBlock>
}>

function draw(
  locales: readonly GuestLocale[],
  style: 'paper' | 'immersive',
  accent = '#EAD6A8',
): Draw {
  const { doc, fonts } = newDocument()
  const rects = vi.spyOn(doc, 'rect')
  const rounded = vi.spyOn(doc, 'roundedRect')
  const text = vi.spyOn(doc, 'text')
  const path = vi.spyOn(doc, 'path')
  const circle = vi.spyOn(doc, 'circle')
  const cues = cueLinesFor(locales)
  const plan = planPdfCodeBlock(doc, fonts, cues)
  const colours = codeBlockColours(printKitPalette(accent, null, style))
  drawCodeBlock(doc, fonts, { qr: QR, cues, colours }, plan, { x: 100, y: 50 })
  return {
    rects: rects.mock.calls.map((call) => [...call] as number[]),
    rounded: rounded.mock.calls.map((call) => [...call] as number[]),
    texts: text.mock.calls.map((call) => {
      const [line, x, y] = call as unknown as [string, number, number]
      return { text: line, x, y }
    }),
    paths: path.mock.calls.map(([data]) => data as string),
    circles: circle.mock.calls.map((call) => [...call] as number[]),
    plan,
  }
}

describe('drawCodeBlock', () => {
  const near = (actual: number | undefined, expected: number) =>
    expect(actual ?? Number.NaN).toBeCloseTo(expected, 6)

  it('places the tile at exactly 2 in square and the bar under it exactly 2 in wide', () => {
    const { rects, plan } = draw(['en', 'es'], 'immersive')
    const tile = rects.find(([, , w, h]) => w === 144 && h === 144)
    const bar = rects.find(([, , w, h]) => w === 144 && h === plan.barPt)
    expect(tile).toEqual([100, 50, 144, 144])
    expect(bar).toEqual([100, 50 + 144, 144, inToPt(0.45)])
    expect(ptToIn(plan.heightPt)).toBeCloseTo(2.45, 10)
  })

  it('rounds the whole object at 0.10 in, tile and bar together', () => {
    const { rounded, plan } = draw(['en', 'es'], 'immersive')
    expect(rounded).toEqual([[100, 50, 144, plan.heightPt, inToPt(0.1)]])
  })

  it('draws the code at the full size of the tile, never distorted, inside its quiet zone', () => {
    const { rects } = draw(['en', 'es'], 'immersive')
    const module = 144 / (QR.size + 8)
    const runs = qrDarkRuns(QR)
    const runRects = rects.filter(([, , , h]) => Math.abs((h ?? 0) - module) < 1e-9)
    expect(runRects).toHaveLength(runs.length)
    const left = Math.min(...runRects.map(([x]) => x ?? 0))
    const right = Math.max(...runRects.map(([x, , w]) => (x ?? 0) + (w ?? 0)))
    const top = Math.min(...runRects.map(([, y]) => y ?? 0))
    const bottom = Math.max(...runRects.map(([, y, , h]) => (y ?? 0) + (h ?? 0)))
    // The symbol is as wide as it is tall, centred in the tile, at least 1.6 in.
    near(right - left, bottom - top)
    near(right - left, codeSymbolPt(QR.size))
    expect(right - left).toBeGreaterThanOrEqual(CODE_SYMBOL_MIN_PT)
    near(left - 100, 244 - right)
    near(top - 50, 194 - bottom)
    near(left - 100, 4 * module)
  })

  it('outlines the Paper tile outside the 2 in, so the bar stays exactly 2 in wide', () => {
    const { rounded, rects, plan } = draw(['en', 'es'], 'paper')
    const outline = mmToPt(0.35)
    expect(rounded).toHaveLength(2)
    expect(rounded[0]).toEqual([
      100 - outline,
      50 - outline,
      144 + 2 * outline,
      plan.heightPt + 2 * outline,
      inToPt(0.1) + outline,
    ])
    expect(rounded[1]).toEqual([100, 50, 144, plan.heightPt, inToPt(0.1)])
    expect(rects.find(([, , w, h]) => w === 144 && h === plan.barPt)).toEqual([
      100,
      50 + 144,
      144,
      plan.barPt,
    ])
  })

  it('draws no outline on Immersive', () => {
    expect(draw(['en'], 'immersive').rounded).toHaveLength(1)
  })

  it('draws the camera as a body and a lens, in strokes', () => {
    const { paths, circles } = draw(['en', 'es'], 'paper')
    expect(paths).toEqual([CAMERA_ICON.body])
    expect(circles).toEqual([
      [CAMERA_ICON.lens.cx, CAMERA_ICON.lens.cy, CAMERA_ICON.lens.r],
    ])
  })

  it('sets the lead language first and the second below it, both from the same left edge', () => {
    const { texts } = draw(['es', 'en'], 'immersive')
    const lines = texts.filter(({ text }) => !/^\s*$/u.test(text))
    const [first, second] = [
      lines.find(({ text }) => text.startsWith('Escanee')),
      lines.find(({ text }) => text.startsWith('Scan')),
    ]
    expect(first && second).toBeTruthy()
    expect(first?.y ?? 0).toBeLessThan(second?.y ?? 0)
    near(first?.x, second?.x ?? 0)
  })

  it('centres the pictogram and the text as one group in the bar', () => {
    const { doc, fonts } = newDocument()
    const text = vi.spyOn(doc, 'text')
    const cues = cueLinesFor(['en', 'es'])
    const plan = planPdfCodeBlock(doc, fonts, cues)
    const colours = codeBlockColours(printKitPalette('#EAD6A8', null, 'immersive'))
    drawCodeBlock(doc, fonts, { qr: QR, cues, colours }, plan, { x: 100, y: 50 })
    const start = text.mock.calls[0]?.[1] as number
    const style = { ...cueStyle(9), spacing: 9 * CODE_BLOCK.cueTrackingEm }
    const widest = Math.max(
      ...cues.map((cue) => measureLine(doc, fonts, cue.text, style)),
    )
    const groupLeft = start - CODE_BLOCK.iconGapPt - plan.iconPt
    const groupRight = start + widest
    near(groupLeft - 100, 244 - groupRight)
  })

  it('moves the pictogram above the lines, in a taller bar, when a line does not fit beside it', () => {
    const above = draw(['fr', 'en'], 'immersive')
    expect(above.plan.iconAbove).toBe(true)
    expect(ptToIn(above.plan.barPt)).toBeCloseTo(0.53, 10)
    const bar = above.rects.find(([, , w, h]) => w === 144 && h === above.plan.barPt)
    expect(bar).toEqual([100, 194, 144, above.plan.barPt])
    // Every cue line starts under the pictogram, which is centred on the bar.
    const lines = above.texts.filter(({ text }) => text.length > 2)
    const barTop = 194
    for (const line of lines) expect(line.y).toBeGreaterThan(barTop + above.plan.iconPt)
    for (const line of lines) expect(line.x).toBeGreaterThan(100)
  })

  it('sets the bar’s text in ink or white, whichever the accent calls for', () => {
    const { doc, fonts } = newDocument()
    const cues = cueLinesFor(['en'])
    const plan = planPdfCodeBlock(doc, fonts, cues)
    // The colour that is current when a line is drawn.
    let current: unknown
    const fill = doc.fillColor.bind(doc) as (...args: unknown[]) => PDFKit.PDFDocument
    vi.spyOn(doc, 'fillColor').mockImplementation(((...args: unknown[]) => {
      current = args[0]
      return fill(...args)
    }) as never)
    const drawn: unknown[] = []
    const text = doc.text.bind(doc) as (...args: unknown[]) => PDFKit.PDFDocument
    vi.spyOn(doc, 'text').mockImplementation(((...args: unknown[]) => {
      drawn.push(current)
      return text(...args)
    }) as never)
    for (const accent of ['#EAD6A8', '#C8102E']) {
      const colours = codeBlockColours(printKitPalette(accent, null, 'immersive'))
      drawCodeBlock(doc, fonts, { qr: QR, cues, colours }, plan, { x: 0, y: 0 })
    }
    expect([...new Set(drawn)]).toEqual(['#121614', '#FFFFFF'])
  })
})
