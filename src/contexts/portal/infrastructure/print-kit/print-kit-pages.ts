// The pages of a print (spec 6): each page sized from its sheet, each
// face placed by the top-left corner of its trim and, on a folded tent, turned
// about its centre so it reads upright once folded; then the sheet's own marks.
//
// A face is laid out once per side and shape and drawn wherever the sheet puts
// it: the Letter card sheet shows the same front twice, the A4 sheet four times.
// Laying out comes first, for every face of the print, so an Immersive print can
// crop its photo to each window the layout made before anything is drawn.
//
// The style says how a face is laid out and drawn; the sheet says how far each
// face bleeds, edge by edge. A Paper face has no bleed and is clipped to its
// trim, so nothing of one card prints on its neighbour; an Immersive face runs
// its field past the trim on every side but a tent's fold and, on an office
// sheet of abutting cards, the edges it shares with its neighbours. A Mini on
// the business-card grid is turned a quarter about its centre.

import type { PrintFace, PrintFaceSide } from '#/shared/domain/portal-print-kit'
import { LOGO_MIN_DPI } from '#/shared/domain/portal-print-kit-measures'
import {
  PANEL_SIZE_PT,
  type PanelBleed,
  type PanelGeometry,
  type PrintKitPage,
  type PrintKitPagePanel,
} from '#/shared/domain/portal-print-kit-sheets'
import { setPageBoxes } from './print-kit-marks'

/** Something worth telling the people who run the service, which does not stop the print. */
export type PrintKitWarning = Readonly<{
  message: string
  context: Readonly<Record<string, unknown>>
}>

export type PrintDocument = Readonly<{
  doc: PDFKit.PDFDocument
  faces: readonly PrintFace[]
  warn: (warning: PrintKitWarning) => void
}>

/** How far a face's art runs past each edge of its trim; none at a tent's fold, none on Paper. */
export type FaceBleed = PanelBleed

type LayoutKey = `${PrintFaceSide}:${PanelGeometry}`

/** Every face of a print, laid out once per side and shape. */
export type FaceLayouts<L> = ReadonlyMap<LayoutKey, L>

const keyOf = (panel: PrintKitPagePanel): LayoutKey => `${panel.side}:${panel.geometry}`

/** Each panel the pages show, with the face laid out for it. */
export function panelLayouts<L>(
  pages: readonly PrintKitPage[],
  layouts: FaceLayouts<L>,
): readonly Readonly<{ panel: PrintKitPagePanel; layout: L }>[] {
  return pages.flatMap((page) =>
    page.panels.flatMap((panel) => {
      const layout = layouts.get(keyOf(panel))
      return layout === undefined ? [] : [{ panel, layout }]
    }),
  )
}

/** How a style draws a face it has laid out. */
export type FaceDrawer<L> = Readonly<{
  /** Draws the face in its own coordinates, its art running `bleed` past the trim. */
  draw: (layout: L, bleed: FaceBleed) => void
  /** The dots per inch the face's logo prints at; null for a wordmark. */
  logoDpi: (layout: L) => number | null
}>

/** Lays out every face the pages show. */
export function layoutFaces<L>(
  faces: readonly PrintFace[],
  pages: readonly PrintKitPage[],
  layout: (face: PrintFace, geometry: PanelGeometry) => L,
): FaceLayouts<L> {
  const layouts = new Map<LayoutKey, L>()
  for (const panel of pages.flatMap((page) => page.panels)) {
    const face = faces.find((candidate) => candidate.side === panel.side)
    if (face === undefined || layouts.has(keyOf(panel))) continue
    layouts.set(keyOf(panel), layout(face, panel.geometry))
  }
  return layouts
}

/** One warning for a print whose logo prints soft anywhere on it: the softest place says how soft. */
function warnOfSoftLogo<L>(
  target: PrintDocument,
  layouts: FaceLayouts<L>,
  drawer: FaceDrawer<L>,
): void {
  const dpis = [...layouts.values()].flatMap((layout) => {
    const dpi = drawer.logoDpi(layout)
    return dpi === null ? [] : [dpi]
  })
  const lowest = Math.min(...dpis)
  if (lowest >= LOGO_MIN_DPI) return
  target.warn({
    message: 'The print kit logo prints below the resolution a print needs',
    context: { dpi: Math.round(lowest), minimumDpi: LOGO_MIN_DPI },
  })
}

function drawPanel<L>(
  target: PrintDocument,
  panel: PrintKitPagePanel,
  layout: L,
  drawer: FaceDrawer<L>,
): void {
  const { widthPt, heightPt } = PANEL_SIZE_PT[panel.geometry]
  const { bleed } = panel
  const { doc } = target
  const centre: [number, number] = [widthPt / 2, heightPt / 2]
  doc.save()
  doc.translate(panel.leftPt, panel.topPt)
  if (panel.rotated) doc.rotate(180, { origin: centre })
  if (panel.turned) doc.rotate(-90, { origin: centre })
  doc
    .rect(
      -bleed.leftPt,
      -bleed.topPt,
      widthPt + bleed.leftPt + bleed.rightPt,
      heightPt + bleed.topPt + bleed.bottomPt,
    )
    .clip()
  drawer.draw(layout, bleed)
  doc.restore()
}

/** Draws the pages of a print into the document, in order; `decorate` adds each page's marks. */
export function drawPrintPages<L>(
  target: PrintDocument,
  pages: readonly PrintKitPage[],
  layouts: FaceLayouts<L>,
  drawer: FaceDrawer<L>,
  decorate: (page: PrintKitPage) => void,
): void {
  for (const page of pages) {
    target.doc.addPage({ size: [page.widthPt, page.heightPt], margin: 0 })
    setPageBoxes(target.doc.page, page)
    for (const panel of page.panels) {
      const layout = layouts.get(keyOf(panel))
      if (layout !== undefined) drawPanel(target, panel, layout, drawer)
    }
    decorate(page)
  }
  warnOfSoftLogo(target, layouts, drawer)
}
