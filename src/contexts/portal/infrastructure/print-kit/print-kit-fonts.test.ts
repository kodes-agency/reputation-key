import { describe, expect, it } from 'vitest'
import { PRINT_KIT_FONT_FACES, printKitFontBytes } from './print-kit-fonts'
import { FONT_SUBSET_RANGES, type FontSubset } from './print-kit-font-ranges'

const SUBSETS = Object.keys(FONT_SUBSET_RANGES) as FontSubset[]
const TRUETYPE_SIGNATURE = '00010000'

/** Every code point a subset is declared to carry, as one string. */
function everyCharacterOf(subset: FontSubset): string {
  return FONT_SUBSET_RANGES[subset]
    .flatMap(([from, to]) =>
      Array.from({ length: to - from + 1 }, (_, offset) =>
        String.fromCodePoint(from + offset),
      ),
    )
    .join('')
}

describe('printKitFontBytes', () => {
  it('has a font file for every face in every subset', () => {
    for (const face of PRINT_KIT_FONT_FACES) {
      for (const subset of SUBSETS) {
        const bytes = printKitFontBytes(face, subset)
        expect(bytes.subarray(0, 4).toString('hex'), `${face} ${subset}`).toBe(
          TRUETYPE_SIGNATURE,
        )
        expect(bytes.length).toBeGreaterThan(1000)
      }
    }
  })

  it('embeds every character of every subset without a subsetting error', async () => {
    const { default: PDFDocument } = await import('pdfkit')
    for (const face of PRINT_KIT_FONT_FACES) {
      for (const subset of SUBSETS) {
        const doc = new PDFDocument({ autoFirstPage: false, font: '' })
        doc.on('data', () => undefined)
        doc.addPage({ size: [200, 200], margin: 0 })
        doc.registerFont('face', printKitFontBytes(face, subset))
        doc.font('face').fontSize(8).text(everyCharacterOf(subset), 0, 0)
        expect(() => doc.end(), `${face} ${subset}`).not.toThrow()
      }
    }
  })

  it('hands back the same bytes each time', () => {
    expect(printKitFontBytes('display', 'cyrillic')).toBe(
      printKitFontBytes('display', 'cyrillic'),
    )
  })
})
