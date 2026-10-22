// The print kit as a PDF, drawn with PDFKit (MIT, maintained) as vectors: the
// code is rectangles, the type is the guest fonts embedded as subsets, and only
// the photo and a logo are raster. Page by page, a sheet is its trim plus a
// 3 mm bleed plus a margin for crop marks, with the trim and bleed declared in
// the page boxes.
//
// A request that names a style (Paper or Immersive) is drawn from the redesign's
// sheets instead (`print-kit-pages.ts`): the page is the sheet, the faces sit
// where `printKitPages` puts them. Without a style the file is today's.
//
// PDFKit is imported lazily and kept external to the server bundle: it reads
// its own font metrics at load and resolves them from `node_modules`, which a
// bundled copy would not find.

import { PRINT_KIT_BLEED_MM, printKitSheets } from '#/shared/domain/portal-print-kit'
import { SLUG_MM } from '#/shared/domain/portal-print-kit-layout'
import type { PrintSheet } from '#/shared/domain/portal-print-kit'
import type {
  PortalPrintKitRenderer,
  PrintKitRenderInput,
} from '../../application/ports/portal-print-kit-renderer.port'
import { PANEL_HEIGHT_MM, PANEL_WIDTH_MM, mm } from './print-kit-geometry'
import { coverPhotoJpeg, logoPng } from './print-kit-image'
import { openImage } from './print-kit-pdf-image'
import {
  drawCropMarks,
  drawFoldMarks,
  drawPrintCheck,
  drawTicks,
  frameOf,
  setPageBoxes,
  type SheetFrame,
} from './print-kit-marks'
import { drawPanel, photoBox, type PanelArt, type PanelBleed } from './print-kit-panel'
import {
  logoNeedsPaperPlate,
  paperLogoPlate,
  paperPrintKitPalette,
  printKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import { printKitPages } from '#/shared/domain/portal-print-kit-sheets'
import type { PrintKitPaper } from '#/shared/domain/portal-print-kit'
import { brandDpi } from './print-kit-face-brand'
import { logoArt } from './print-kit-image'
import { drawImmersivePrint } from './print-kit-immersive-document'
import { drawStyledPages, layoutFaces, type PrintKitWarning } from './print-kit-pages'
import { drawPaperFace, layoutPaperFace, type PaperFaceArt } from './print-kit-paper-face'
import { PrintKitFonts } from './print-kit-pdf-text'
import { qrMatrix } from './print-kit-qr'

export type PdfKitPrintKitRendererDeps = Readonly<{
  /** The clock the document's creation date reads. */
  now: () => Date
  /** Streams compress by default; a test turns it off to read what was drawn. */
  compress?: boolean
  /** Told of what is worth a look but does not stop the print, such as a soft logo. */
  warn?: (warning: PrintKitWarning) => void
}>

type PanelPlacement = Readonly<{ originX: number; originY: number; rotated: boolean }>

function placementOf(
  frame: SheetFrame,
  panel: PrintSheet['panels'][number],
): PanelPlacement {
  return {
    originX: frame.trimLeft,
    originY: frame.trimTop + mm(panel.topMm),
    rotated: panel.rotated,
  }
}

/** A panel's bleed: none at the fold of a table tent, the full 3 mm elsewhere. */
const bleedOf = (sheet: PrintSheet): PanelBleed => ({
  topMm: sheet.foldAtMm === null ? PRINT_KIT_BLEED_MM : 0,
  sideMm: PRINT_KIT_BLEED_MM,
  bottomMm: PRINT_KIT_BLEED_MM,
})

async function artOf(
  doc: PDFKit.PDFDocument,
  input: PrintKitRenderInput,
  bleed: PanelBleed,
): Promise<PanelArt> {
  const { photo, logo } = input
  const box = photoBox(bleed)
  return {
    palette: printKitPalette(input.accentColour, input.fieldColour),
    wordmark: input.wordmark,
    logo: logo === null ? null : openImage(doc, (await logoPng(logo)).bytes),
    photo:
      photo === null
        ? null
        : openImage(
            doc,
            await coverPhotoJpeg(photo.bytes, {
              ...box,
              focalX: photo.focalX,
              focalY: photo.focalY,
            }),
          ),
    qr: qrMatrix(input.qrAddress),
  }
}

function drawSheet(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  sheet: PrintSheet,
  input: PrintKitRenderInput,
  art: PanelArt,
): void {
  const frame = frameOf(sheet)
  doc.addPage({ size: [frame.pageWidth, frame.pageHeight], margin: 0 })
  setPageBoxes(doc.page, frame)
  const bleed = bleedOf(sheet)
  for (const panel of sheet.panels) {
    const face = input.faces.find((candidate) => candidate.side === panel.side)
    if (face === undefined) continue
    const placement = placementOf(frame, panel)
    doc.save()
    doc.translate(placement.originX, placement.originY)
    if (placement.rotated) {
      doc.rotate(180, { origin: [mm(PANEL_WIDTH_MM) / 2, mm(PANEL_HEIGHT_MM) / 2] })
    }
    drawPanel(doc, fonts, face, art, bleed)
    doc.restore()
  }
  drawCropMarks(doc, frame)
  if (sheet.foldAtMm !== null) drawFoldMarks(doc, frame, sheet.foldAtMm)
}

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
  drawStyledPages(
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

/** The redesigned print: a style's pages on its paper. */
async function drawStyled(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  input: PrintKitRenderInput,
  warn: (warning: PrintKitWarning) => void,
): Promise<void> {
  const { style, paper } = input
  if (style === undefined || paper === undefined) {
    throw new Error(
      `The print kit cannot draw the ${style ?? 'unnamed'} style on ${paper ?? 'no'} paper`,
    )
  }
  if (style === 'paper') await drawPaperPrint(doc, fonts, input, paper, warn)
  else await drawImmersivePrint(doc, fonts, input, paper, warn)
}

/** Today's print: A6 panels with a 3 mm bleed and crop marks. */
async function drawLegacy(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  input: PrintKitRenderInput,
): Promise<void> {
  const sheets = printKitSheets(input.piece, input.faces.length)
  // The pictures are cropped per bleed; the sheets of one piece share it.
  const [first] = sheets
  if (first === undefined) throw new Error('A print kit needs at least one face')
  const art = await artOf(doc, input, bleedOf(first))
  for (const sheet of sheets) drawSheet(doc, fonts, sheet, input, art)
}

const subjectOf = (input: PrintKitRenderInput): string =>
  input.style === undefined
    ? `Print kit, ${SLUG_MM} mm slug with ${PRINT_KIT_BLEED_MM} mm bleed`
    : `Print kit, ${input.style} on ${input.paper ?? 'its default'} paper`

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
          Subject: subjectOf(input),
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
      if (input.style === undefined) await drawLegacy(doc, fonts, input)
      else await drawStyled(doc, fonts, input, deps.warn ?? (() => undefined))
      doc.end()
      await finished
      return new Uint8Array(Buffer.concat(chunks))
    },
  }
}
