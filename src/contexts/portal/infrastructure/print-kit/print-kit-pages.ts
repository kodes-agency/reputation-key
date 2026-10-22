// The pages of a redesigned print (spec 6): each page sized from its sheet, each
// face placed by the top-left corner of its trim and, on a folded tent, turned
// about its centre so it reads upright once folded; then the sheet's own marks.
//
// A face is laid out once per side and shape and drawn wherever the sheet puts
// it: the Letter card sheet shows the same front twice, the A4 sheet four times.

import type { PrintFace, PrintFaceSide } from '#/shared/domain/portal-print-kit'
import { LOGO_MIN_DPI } from '#/shared/domain/portal-print-kit-measures'
import {
  PANEL_SIZE_PT,
  type PanelGeometry,
  type PrintKitPage,
  type PrintKitPagePanel,
} from '#/shared/domain/portal-print-kit-sheets'
import { brandDpi } from './print-kit-face-brand'
import { drawPrintCheck, drawTicks, setStyledPageBoxes } from './print-kit-marks'
import {
  drawPaperFace,
  layoutPaperFace,
  type PaperFaceArt,
  type PaperFaceLayout,
} from './print-kit-paper-face'
import type { PrintKitFonts } from './print-kit-pdf-text'

/** Something worth telling the people who run the service, which does not stop the print. */
export type PrintKitWarning = Readonly<{
  message: string
  context: Readonly<Record<string, unknown>>
}>

export type StyledDocument = Readonly<{
  doc: PDFKit.PDFDocument
  fonts: PrintKitFonts
  faces: readonly PrintFace[]
  art: PaperFaceArt
  warn: (warning: PrintKitWarning) => void
}>

type Layouts = Map<`${PrintFaceSide}:${PanelGeometry}`, PaperFaceLayout>

function layoutFor(
  target: StyledDocument,
  layouts: Layouts,
  panel: PrintKitPagePanel,
  face: PrintFace,
): PaperFaceLayout {
  const key = `${panel.side}:${panel.geometry}` as const
  const known = layouts.get(key)
  if (known !== undefined) return known
  const layout = layoutPaperFace(
    target.doc,
    target.fonts,
    face,
    target.art,
    panel.geometry,
  )
  layouts.set(key, layout)
  return layout
}

/** One warning for a print whose logo prints soft anywhere on it: the softest place says how soft. */
function warnOfSoftLogo(target: StyledDocument, layouts: Layouts): void {
  const dpis = [...layouts.values()].flatMap((layout) => {
    const dpi = brandDpi(layout.brand.plan)
    return dpi === null ? [] : [dpi]
  })
  const lowest = Math.min(...dpis)
  if (lowest >= LOGO_MIN_DPI) return
  target.warn({
    message: 'The print kit logo prints below the resolution a print needs',
    context: { dpi: Math.round(lowest), minimumDpi: LOGO_MIN_DPI },
  })
}

function drawPanel(
  target: StyledDocument,
  layouts: Layouts,
  panel: PrintKitPagePanel,
): void {
  const face = target.faces.find((candidate) => candidate.side === panel.side)
  if (face === undefined) return
  const layout = layoutFor(target, layouts, panel, face)
  const { widthPt, heightPt } = PANEL_SIZE_PT[panel.geometry]
  const { doc } = target
  doc.save()
  doc.translate(panel.leftPt, panel.topPt)
  if (panel.rotated) doc.rotate(180, { origin: [widthPt / 2, heightPt / 2] })
  // Faces abut on a card sheet: nothing of one may print on its neighbour.
  doc.rect(0, 0, widthPt, heightPt).clip()
  drawPaperFace(doc, target.fonts, layout)
  doc.restore()
}

/** Draws the pages of a styled print into the document, in order. */
export function drawStyledPages(
  target: StyledDocument,
  pages: readonly PrintKitPage[],
): void {
  const layouts: Layouts = new Map()
  for (const page of pages) {
    target.doc.addPage({ size: [page.widthPt, page.heightPt], margin: 0 })
    setStyledPageBoxes(target.doc.page, page)
    for (const panel of page.panels) drawPanel(target, layouts, panel)
    drawTicks(target.doc, page.ticks)
    if (page.printCheck) drawPrintCheck(target.doc, target.fonts, target.art.palette)
  }
  warnOfSoftLogo(target, layouts)
}
