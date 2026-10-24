// The final print kit as a PDF (final design spec, slice 3): single pieces, one
// face per page at its trim, drawn with PDFKit as vectors (the code is
// rectangles, the type is the guest fonts embedded as subsets; only a logo is
// raster). Paper faces only so far: the Immersive renderer and the office
// sheets are later slices, and a request for either is a bug in the caller.
//
// The tile follows the symbol the address makes (`choosePrintFinalTile`): a
// piece whose module would print under 0.85 mm is refused before any page is
// drawn, and so is a pair of languages whose cues would not keep their padding
// in the bar (`cue_does_not_fit`). PDFKit is imported lazily, as for today's kit.

import {
  PrintFinalRenderRefusal,
  type PortalPrintFinalRenderer,
  type PrintFinalRenderInput,
} from '../../application/ports/portal-print-final-renderer.port'
import {
  choosePrintFinalTile,
  printFinalCuesFit,
} from '#/shared/domain/portal-print-final-code'
import { PRINT_FINAL_MEASURES } from '#/shared/domain/portal-print-final-measures'
import { paperPrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import {
  drawFinalPaperFace,
  layoutFinalFace,
  type FinalFaceArt,
} from './print-kit-final-face'
import { logoArt } from './print-kit-image'
import { openImage } from './print-kit-pdf-image'
import { PrintKitFonts } from './print-kit-pdf-text'
import { qrMatrix } from './print-kit-qr'

export type PdfKitPrintFinalRendererDeps = Readonly<{
  /** The clock the document's creation date reads. */
  now: () => Date
  /** Streams compress by default; a test turns it off to read what was drawn. */
  compress?: boolean
}>

async function drawPiece(
  doc: PDFKit.PDFDocument,
  input: PrintFinalRenderInput,
): Promise<void> {
  const { face } = input
  if (face.look !== 'paper') {
    throw new Error('The final print kit draws Paper faces so far, not Immersive ones')
  }
  const qr = qrMatrix(input.qrAddress)
  const tile = choosePrintFinalTile({
    ...face,
    address: input.address,
    symbolModules: qr.size,
  })
  if (tile.isErr()) throw new PrintFinalRenderRefusal(tile.error)
  const logo = input.logo === null ? null : await logoArt(input.logo)
  const art: FinalFaceArt = {
    palette: paperPrintKitPalette(input.accentColour),
    qr,
    wordmark: input.wordmark,
    logo: logo === null ? null : { image: openImage(doc, logo.bytes), ink: logo.ink },
  }
  const fonts = new PrintKitFonts(doc)
  const layout = layoutFinalFace(doc, fonts, {
    face,
    blocks: input.blocks,
    tile: tile.value,
    art,
  })
  const { cuePt } = PRINT_FINAL_MEASURES[face.region][face.piece]
  const cueLines = layout.cues.map((cue) => cue.text)
  if (!printFinalCuesFit(cueLines, tile.value.tilePt, cuePt)) {
    throw new PrintFinalRenderRefusal({ code: 'cue_does_not_fit', moduleMm: null })
  }
  doc.addPage({ size: [layout.plan.widthPt, layout.plan.heightPt], margin: 0 })
  drawFinalPaperFace(doc, fonts, layout, art)
}

export function createPdfKitPrintFinalRenderer(
  deps: PdfKitPrintFinalRendererDeps,
): PortalPrintFinalRenderer {
  return {
    render: async (input) => {
      const { default: PDFDocument } = await import('pdfkit')
      const doc = new PDFDocument({
        autoFirstPage: false,
        // The tile's clip and the outline's ring want nothing past PDF 1.4, which
        // today's kit writes too.
        pdfVersion: '1.4',
        // No default font: every line is set in an embedded guest font.
        font: '',
        compress: deps.compress ?? true,
        info: {
          Title: input.title,
          Author: 'Reputation Key',
          CreationDate: deps.now(),
        },
      })
      const chunks: Buffer[] = []
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      const finished = new Promise<void>((resolve, reject) => {
        doc.on('end', resolve)
        doc.on('error', reject)
      })
      await drawPiece(doc, input)
      doc.end()
      await finished
      return new Uint8Array(Buffer.concat(chunks))
    },
  }
}
