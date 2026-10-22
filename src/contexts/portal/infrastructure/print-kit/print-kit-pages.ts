// The pages of a redesigned print (spec 6): each page sized from its sheet, each
// face placed by the top-left corner of its trim and, on a folded tent, turned
// about its centre so it reads upright once folded; then the sheet's own marks.
//
// A face is laid out once per side and shape and drawn wherever the sheet puts
// it: the Letter card sheet shows the same front twice, the A4 sheet four times.
// Laying out comes first, for every face of the print, so an Immersive print can
// crop its photo to each window the layout made before anything is drawn.
//
// The style says how a face is laid out and drawn; the page says how far it
// bleeds. A Paper face has no bleed and is clipped to its trim, so nothing of one
// card prints on its neighbour; an Immersive face runs its field past the trim on
// every side but a tent's fold.

import type { PrintFace, PrintFaceSide } from '#/shared/domain/portal-print-kit'
import { LOGO_MIN_DPI } from '#/shared/domain/portal-print-kit-measures'
import {
  PANEL_SIZE_PT,
  type PanelGeometry,
  type PrintKitPage,
  type PrintKitPagePanel,
} from '#/shared/domain/portal-print-kit-sheets'
import { setStyledPageBoxes } from './print-kit-marks'

/** Something worth telling the people who run the service, which does not stop the print. */
export type PrintKitWarning = Readonly<{
  message: string
  context: Readonly<Record<string, unknown>>
}>

export type StyledDocument = Readonly<{
  doc: PDFKit.PDFDocument
  faces: readonly PrintFace[]
  warn: (warning: PrintKitWarning) => void
}>

/** How far a face's art runs past its trim on each side; none at a tent's fold, none on Paper. */
export type FaceBleed = Readonly<{ topPt: number; sidePt: number; bottomPt: number }>

type LayoutKey = `${PrintFaceSide}:${PanelGeometry}`

/** Every face of a print, laid out once per side and shape. */
export type FaceLayouts<L> = ReadonlyMap<LayoutKey, L>

const keyOf = (panel: PrintKitPagePanel): LayoutKey => `${panel.side}:${panel.geometry}`

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
  target: StyledDocument,
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

/** How far a face on `page` bleeds: the page's bleed, except across a tent's fold. */
function bleedOf(page: PrintKitPage): FaceBleed {
  return {
    topPt: page.foldAtPt === null ? page.bleedPt : 0,
    sidePt: page.bleedPt,
    bottomPt: page.bleedPt,
  }
}

function drawPanel<L>(
  target: StyledDocument,
  page: PrintKitPage,
  panel: PrintKitPagePanel,
  layout: L,
  drawer: FaceDrawer<L>,
): void {
  const { widthPt, heightPt } = PANEL_SIZE_PT[panel.geometry]
  const bleed = bleedOf(page)
  const { doc } = target
  doc.save()
  doc.translate(panel.leftPt, panel.topPt)
  if (panel.rotated) doc.rotate(180, { origin: [widthPt / 2, heightPt / 2] })
  doc
    .rect(
      -bleed.sidePt,
      -bleed.topPt,
      widthPt + 2 * bleed.sidePt,
      heightPt + bleed.topPt + bleed.bottomPt,
    )
    .clip()
  drawer.draw(layout, bleed)
  doc.restore()
}

/** Draws the pages of a styled print into the document, in order; `decorate` adds each page's marks. */
export function drawStyledPages<L>(
  target: StyledDocument,
  pages: readonly PrintKitPage[],
  layouts: FaceLayouts<L>,
  drawer: FaceDrawer<L>,
  decorate: (page: PrintKitPage) => void,
): void {
  for (const page of pages) {
    target.doc.addPage({ size: [page.widthPt, page.heightPt], margin: 0 })
    setStyledPageBoxes(target.doc.page, page)
    for (const panel of page.panels) {
      const layout = layouts.get(keyOf(panel))
      if (layout !== undefined) drawPanel(target, page, panel, layout, drawer)
    }
    decorate(page)
  }
  warnOfSoftLogo(target, layouts, drawer)
}
