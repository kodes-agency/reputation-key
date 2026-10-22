import PDFDocument from 'pdfkit'
import { describe, expect, it, vi } from 'vitest'
import {
  drawCentredLine,
  drawLine,
  measureLine,
  PrintKitFonts,
  type PdfTextStyle,
} from './print-kit-pdf-text'

type ShapedGlyph = Readonly<{ id: number; name: string }>

/** The glyphs PDFKit's current font shapes `text` into: what it would draw. */
function shape(
  doc: PDFKit.PDFDocument,
  text: string,
  features?: Record<string, boolean>,
): readonly ShapedGlyph[] {
  const { _font: font } = doc as unknown as {
    _font: {
      layout: (
        text: string,
        features?: Record<string, boolean>,
      ) => { glyphs: readonly ShapedGlyph[] }
    }
  }
  return font.layout(text, features).glyphs
}

function newDocument(): PDFKit.PDFDocument {
  const doc = new PDFDocument({ autoFirstPage: false, font: '', compress: false })
  doc.on('data', () => undefined)
  doc.addPage({ size: [300, 300], margin: 0 })
  return doc
}

const style = (face: PdfTextStyle['face'], spacing = 0): PdfTextStyle => ({
  face,
  size: 9,
  spacing,
  colour: '#121614',
  opacity: 1,
})

describe('the Bulgarian forms in a Cyrillic run', () => {
  // Bulgarian draws д, т and л differently from Russian (the `locl` forms of the
  // `BGR ` language system). PDFKit gives fontkit no language, so the forms are
  // frozen into the Cyrillic files (scripts/fonts/freeze-bg-locl.py); a glyph
  // id is what would change if a font update dropped them.
  const cases = [
    ['display', [97, 109, 104]],
    ['body', [138, 149, 145]],
    ['bodyStrong', [138, 149, 145]],
  ] as const

  it.each(cases)('shapes д т л in the %s face into the Bulgarian glyphs', (face, ids) => {
    const doc = newDocument()
    new PrintKitFonts(doc).use(face, 'cyrillic', 9)

    const glyphs = shape(doc, 'дтл')

    expect(glyphs.map((glyph) => glyph.id)).toEqual(ids)
    expect(glyphs.map((glyph) => glyph.name)).toEqual([
      'uni0434.loclBGR',
      'uni0442.loclBGR',
      'uni043B.loclBGR',
    ])
  })

  it('leaves Latin letters as they were', () => {
    const doc = newDocument()
    new PrintKitFonts(doc).use('display', 'latin', 9)

    expect(shape(doc, 'dtl').map((glyph) => glyph.name)).toEqual(['d', 't', 'l'])
  })
})

describe('lining figures', () => {
  /** The features `drawLine` asks PDFKit for, as they are when it is asked (fontkit adds to them). */
  function drawnFeatures(face: PdfTextStyle['face'], spacing = 0) {
    const doc = newDocument()
    const original = doc.text.bind(doc) as (...args: unknown[]) => PDFKit.PDFDocument
    let features: Record<string, boolean> | undefined
    vi.spyOn(doc, 'text').mockImplementation(((...args: unknown[]) => {
      const options = args[3] as { features?: Record<string, boolean> }
      features = options.features === undefined ? undefined : { ...options.features }
      return original(...args)
    }) as never)
    drawLine(doc, new PrintKitFonts(doc), 'Chair 3', style(face, spacing), {
      x: 0,
      middleY: 20,
    })
    return { doc, features }
  }

  it('asks the display face for lnum, so Cormorant sets "Chair 3" with a lining 3', () => {
    const { doc, features } = drawnFeatures('display')

    expect(features).toEqual({ lnum: true })
    const three = shape(doc, '3', features)
    const oldStyle = shape(doc, '3')
    expect(three.map((glyph) => glyph.name)).toEqual(['three.lf'])
    expect(oldStyle.map((glyph) => glyph.name)).toEqual(['three'])
  })

  it('leaves the text faces alone: Ysabeau sets lining figures by default', () => {
    expect(drawnFeatures('body').features).toBeUndefined()
    expect(drawnFeatures('bodyStrong').features).toBeUndefined()
  })

  it('keeps the ligatures off a tracked display line as well', () => {
    expect(drawnFeatures('display', 1.5).features).toEqual({
      lnum: true,
      liga: false,
      clig: false,
      dlig: false,
    })
  })
})

describe('drawLine and drawCentredLine', () => {
  it('starts a line at x, and centres a line on its own measure', () => {
    const doc = newDocument()
    const fonts = new PrintKitFonts(doc)
    const spy = vi.spyOn(doc, 'text')
    const line = style('bodyStrong')
    const width = measureLine(doc, fonts, 'Scan with your camera', line)

    drawLine(doc, fonts, 'Scan with your camera', line, { x: 40, middleY: 10 })
    drawCentredLine(doc, fonts, 'Scan with your camera', line, {
      centreX: 150,
      middleY: 30,
    })

    const starts = spy.mock.calls.map(([, x]) => x)
    expect(starts[0]).toBe(40)
    expect(starts[1]).toBeCloseTo(150 - width / 2, 6)
  })
})
