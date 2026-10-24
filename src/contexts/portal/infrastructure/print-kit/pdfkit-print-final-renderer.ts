// The final print kit as a PDF (final design spec, slices 3 and 4): single
// pieces, one face per page at its trim, drawn with PDFKit. Paper is vectors
// (the code is rectangles, the type is the guest fonts embedded as subsets;
// only a logo is raster). Immersive adds its art under them: the ground and
// washes as vectors, the photo with its fade as a soft mask, the scrims, the
// grain (`print-kit-final-immersive.ts`). Office sheets come in later slices.
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
  type PrintFinalTile,
} from '#/shared/domain/portal-print-final-code'
import { PRINT_FINAL_MEASURES } from '#/shared/domain/portal-print-final-measures'
import { printFinalPaperColours } from '#/shared/domain/portal-print-final-colours'
import { paperPrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import {
  drawFinalFace,
  layoutFinalFace,
  type FinalFaceArt,
  type FinalFaceLogo,
} from './print-kit-final-face'
import {
  prepareFinalImmersiveFace,
  type FinalPreparedFace,
} from './print-kit-final-immersive'
import { logoArt } from './print-kit-image'
import { openImage } from './print-kit-pdf-image'
import { PrintKitFonts } from './print-kit-pdf-text'
import { qrMatrix, type QrMatrix } from './print-kit-qr'

export type PdfKitPrintFinalRendererDeps = Readonly<{
  /** The clock the document's creation date reads. */
  now: () => Date
  /** Streams compress by default; a test turns it off to read what was drawn. */
  compress?: boolean
}>

function preparePaperFace(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  common: Readonly<{
    input: PrintFinalRenderInput
    tile: PrintFinalTile
    qr: QrMatrix
    logo: FinalFaceLogo | null
  }>,
): FinalPreparedFace {
  const { input, tile, qr, logo } = common
  const art: FinalFaceArt = {
    colours: printFinalPaperColours(paperPrintKitPalette(input.accentColour)),
    qr,
    wordmark: input.wordmark,
    logo,
  }
  const layout = layoutFinalFace(doc, fonts, {
    face: input.face,
    blocks: input.blocks,
    tile,
    art,
  })
  return { layout, draw: () => drawFinalFace(doc, fonts, layout, art) }
}

async function drawPiece(
  doc: PDFKit.PDFDocument,
  input: PrintFinalRenderInput,
): Promise<void> {
  const { face } = input
  const qr = qrMatrix(input.qrAddress)
  const tile = choosePrintFinalTile({
    ...face,
    address: input.address,
    symbolModules: qr.size,
  })
  if (tile.isErr()) throw new PrintFinalRenderRefusal(tile.error)
  const art = input.logo === null ? null : await logoArt(input.logo)
  const logo = art === null ? null : { image: openImage(doc, art.bytes), ink: art.ink }
  const fonts = new PrintKitFonts(doc)
  const common = { input, tile: tile.value, qr, logo }
  const prepared =
    face.look === 'paper'
      ? preparePaperFace(doc, fonts, common)
      : await prepareFinalImmersiveFace(doc, fonts, common)
  const { cuePt } = PRINT_FINAL_MEASURES[face.region][face.piece]
  const cueLines = prepared.layout.cues.map((cue) => cue.text)
  if (!printFinalCuesFit(cueLines, tile.value.tilePt, cuePt)) {
    throw new PrintFinalRenderRefusal({ code: 'cue_does_not_fit', moduleMm: null })
  }
  const { plan } = prepared.layout
  doc.addPage({ size: [plan.widthPt, plan.heightPt], margin: 0 })
  prepared.draw()
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
