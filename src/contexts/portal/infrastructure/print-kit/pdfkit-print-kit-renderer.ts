// The print kit as a PDF, drawn with PDFKit (MIT, maintained) as vectors: the
// code is rectangles, the type is the guest fonts embedded as subsets, and only
// the photo and a logo are raster. A request names a style (Paper or Immersive)
// and a paper: the page is the style's sheet on that paper (`print-kit-pages.ts`),
// and the faces sit where `printKitPages` puts them, with the trim and bleed
// declared in the page boxes.
//
// PDFKit is imported lazily and kept external to the server bundle: it reads
// its own font metrics at load and resolves them from `node_modules`, which a
// bundled copy would not find.

import type {
  PortalPrintKitRenderer,
  PrintKitRenderInput,
} from '../../application/ports/portal-print-kit-renderer.port'
import {
  logoNeedsPaperPlate,
  paperLogoPlate,
  paperPrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import {
  printAddressShape,
  type PrintAddressShape,
} from '#/shared/domain/portal-print-address'
import { printKitFormatProblem } from '#/shared/domain/portal-print-kit-formats'
import { printKitSubject } from '#/shared/domain/portal-print-kit-pieces'
import { printKitPages } from '#/shared/domain/portal-print-kit-sheets'
import type { PrintKitPaper } from '#/shared/domain/portal-print-kit'
import { drawCardPrint } from './print-kit-card-print'
import { brandDpi } from './print-kit-face-brand'
import { logoArt } from './print-kit-image'
import { drawImmersivePrint } from './print-kit-immersive-document'
import { drawPrintCheck, drawTicks } from './print-kit-marks'
import { drawPrintPages, layoutFaces, type PrintKitWarning } from './print-kit-pages'
import { drawPaperFace, layoutPaperFace, type PaperFaceArt } from './print-kit-paper-face'
import { openImage } from './print-kit-pdf-image'
import { PrintKitFonts } from './print-kit-pdf-text'
import { drawSmallTentPrint } from './print-kit-tent-print'
import { qrMatrix, qrSymbolVersion } from './print-kit-qr'

export type PdfKitPrintKitRendererDeps = Readonly<{
  /** The clock the document's creation date reads. */
  now: () => Date
  /** Streams compress by default; a test turns it off to read what was drawn. */
  compress?: boolean
  /** Told of what is worth a look but does not stop the print, such as a soft logo. */
  warn?: (warning: PrintKitWarning) => void
  /**
   * Told, once a print is drawn, what shape of address it carries and which QR
   * version it came to. Never the address: it is a credential (ADR 0069).
   */
  reportRender?: (facts: PrintKitRenderFacts) => void
}>

/** What is worth knowing about a drawn print without the address in it. */
export type PrintKitRenderFacts = Readonly<{
  addressShape: PrintAddressShape
  symbolVersion: number
}>

/** A Paper print: ink on the customer's own sheet, with ticks and, on Letter cards, the print check. */
async function drawPaperPrint(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  input: PrintKitRenderInput,
  paper: PrintKitPaper,
  warn: (warning: PrintKitWarning) => void,
): Promise<void> {
  const palette = paperPrintKitPalette(input.accentColour)
  const logo = input.logo === null ? null : await logoArt(input.logo)
  const plate = logo !== null && logoNeedsPaperPlate(logo.ink.luminance)
  const art: PaperFaceArt = {
    palette,
    qr: qrMatrix(input.qrAddress),
    brand: {
      wordmark: input.wordmark,
      colour: palette.ink,
      logo:
        logo === null
          ? null
          : {
              image: openImage(doc, logo.bytes),
              ink: logo.ink,
              plate: plate ? paperLogoPlate(input.accentColour) : null,
            },
    },
  }
  const pages = printKitPages(input.piece, input.faces.length, 'paper', paper)
  const layouts = layoutFaces(input.faces, pages, (face, geometry) =>
    layoutPaperFace(doc, fonts, face, art, geometry),
  )
  drawPrintPages(
    { doc, faces: input.faces, warn },
    pages,
    layouts,
    {
      draw: (layout) => drawPaperFace(doc, fonts, layout),
      logoDpi: (layout) => brandDpi(layout.brand.plan),
    },
    (page) => {
      drawTicks(doc, page.ticks)
      if (page.printCheck) drawPrintCheck(doc, fonts, palette)
    },
  )
}

/**
 * A print: a style's pages on its paper. The counter card is a card at its size
 * in the round-3 look (`print-kit-card-print.ts`), the tent at size Table is the
 * small landscape tent (`print-kit-tent-print.ts`); the Letter-half tent keeps
 * the look it shipped with until it is retired. A choice the kit does not offer is
 * a bug in the caller, which checks it first.
 */
async function drawPrint(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  input: PrintKitRenderInput,
  warn: (warning: PrintKitWarning) => void,
): Promise<void> {
  const { style, paper } = input
  const problem = printKitFormatProblem({
    piece: input.piece,
    size: input.size,
    style,
    output: input.output,
    languageCount: input.faces[0]?.blocks.length ?? 1,
  })
  if (problem !== null) throw new Error(`Not a printable choice: ${problem}`)
  if (input.piece === 'counter_card') await drawCardPrint(doc, fonts, input, warn)
  else if (input.size === 'table') await drawSmallTentPrint(doc, fonts, input, warn)
  else if (style === 'paper') await drawPaperPrint(doc, fonts, input, paper, warn)
  else await drawImmersivePrint(doc, fonts, input, paper, warn)
}

export function createPdfKitPrintKitRenderer(
  deps: PdfKitPrintKitRendererDeps,
): PortalPrintKitRenderer {
  return {
    render: async (input) => {
      const { default: PDFDocument } = await import('pdfkit')
      const doc = new PDFDocument({
        autoFirstPage: false,
        // The art uses transparency (soft masks, opacity states, gradients), which
        // PDF 1.4 is the first level to have; PDFKit writes 1.3 unless asked, and a
        // preflight or an old RIP reads the header, not the page.
        pdfVersion: '1.4',
        // No default font: PDFKit's own is Helvetica, whose metrics it reads
        // from disk. Every line is set in an embedded guest font.
        font: '',
        compress: deps.compress ?? true,
        info: {
          Title: input.title,
          Author: 'Reputation Key',
          Subject: printKitSubject(input.style, input.piece, input.paper, input.size),
          CreationDate: deps.now(),
        },
      })
      const chunks: Buffer[] = []
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      const finished = new Promise<void>((resolve, reject) => {
        doc.on('end', resolve)
        doc.on('error', reject)
      })
      const fonts = new PrintKitFonts(doc)
      await drawPrint(doc, fonts, input, deps.warn ?? (() => undefined))
      deps.reportRender?.({
        addressShape: printAddressShape(input.qrAddress),
        symbolVersion: qrSymbolVersion(qrMatrix(input.qrAddress)),
      })
      doc.end()
      await finished
      return new Uint8Array(Buffer.concat(chunks))
    },
  }
}
