// The print kit as a PDF, drawn with PDFKit (MIT, maintained) as vectors: the
// code is rectangles, the type is the guest fonts embedded as subsets, and only
// the photo and a logo are raster. Page by page, a sheet is its trim plus a
// 3 mm bleed plus a margin for crop marks, with the trim and bleed declared in
// the page boxes.
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
  frameOf,
  setPageBoxes,
  type SheetFrame,
} from './print-kit-marks'
import { drawPanel, photoBox, type PanelArt, type PanelBleed } from './print-kit-panel'
import { printKitPalette } from '#/shared/domain/portal-print-kit-palette'
import { PrintKitFonts } from './print-kit-pdf-text'
import { qrMatrix } from './print-kit-qr'

export type PdfKitPrintKitRendererDeps = Readonly<{
  /** The clock the document's creation date reads. */
  now: () => Date
  /** Streams compress by default; a test turns it off to read what was drawn. */
  compress?: boolean
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
    shortAddress: input.shortAddress,
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

export function createPdfKitPrintKitRenderer(
  deps: PdfKitPrintKitRendererDeps,
): PortalPrintKitRenderer {
  return {
    render: async (input) => {
      const { default: PDFDocument } = await import('pdfkit')
      const sheets = printKitSheets(input.piece, input.faces.length)
      const doc = new PDFDocument({
        autoFirstPage: false,
        // No default font: PDFKit's own is Helvetica, whose metrics it reads
        // from disk. Every line is set in an embedded guest font.
        font: '',
        compress: deps.compress ?? true,
        info: {
          Title: input.title,
          Author: 'Reputation Key',
          Subject: `Print kit, ${SLUG_MM} mm slug with ${PRINT_KIT_BLEED_MM} mm bleed`,
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
      // The pictures are cropped per bleed; the sheets of one piece share it.
      const [first] = sheets
      if (first === undefined) throw new Error('A print kit needs at least one face')
      const art = await artOf(doc, input, bleedOf(first))
      for (const sheet of sheets) drawSheet(doc, fonts, sheet, input, art)
      doc.end()
      await finished
      return new Uint8Array(Buffer.concat(chunks))
    },
  }
}
