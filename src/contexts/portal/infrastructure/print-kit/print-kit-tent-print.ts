// A small table tent print, from the request to the pages (round-3 spec-delta
// S5): the code on Table's 1.4 in tile (36 mm on A4), refused for an address
// whose modules that tile would print too small; each face laid out in its one
// language; on Immersive the photo cropped once for the panel with the bleed it
// has; and the pages drawn: Paper's two tents on a landscape sheet with cut and
// fold ticks and a note, or Immersive's one tent to a print shop's page with
// crop marks, fold marks and the slug line.
//
// The Letter-half tent (the same piece at size Large) keeps its own drawing
// until it is retired.

import { printKitSheetPages } from '#/shared/domain/portal-print-kit-formats'
import { monogramLetter } from '#/shared/domain/portal-print-kit-immersive'
import type { PrintKitRenderInput } from '../../application/ports/portal-print-kit-renderer.port'
import { areaPhotos, type AreaOf } from './print-kit-area-photos'
import { cardArtOf, logoDpi, sheetMarks } from './print-kit-card-print'
import {
  drawPrintPages,
  layoutFaces,
  panelLayouts,
  type FaceLayouts,
  type PrintKitWarning,
} from './print-kit-pages'
import type { PrintKitFonts } from './print-kit-pdf-text'
import { drawTentFace, layoutTentFace, type TentFaceLayout } from './print-kit-tent-face'

type Warn = (warning: PrintKitWarning) => void

/** A tent's photo panel with its bleed: down the left, into the bleed on the left, top and foot. */
const panelArea: AreaOf<TentFaceLayout> = (layout, bleed) =>
  layout.plan.panelPt === null
    ? null
    : {
        widthPt: layout.plan.panelPt + bleed.leftPt,
        heightPt: layout.plan.heightPt + bleed.topPt + bleed.bottomPt,
      }

/** Draws a small tent print in its style, on the pages of its paper. */
export async function drawSmallTentPrint(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  input: PrintKitRenderInput,
  warn: Warn,
): Promise<void> {
  const art = await cardArtOf(doc, input)
  const pages = printKitSheetPages({
    piece: 'table_tent',
    size: 'table',
    style: input.style,
    output: input.output,
    languageCount: input.faces[0]?.blocks.length ?? 1,
    paper: input.paper,
    faceCount: input.faces.length,
    tilePt: art.tile.tilePt,
  })
  const layouts: FaceLayouts<TentFaceLayout> = layoutFaces(input.faces, pages, (face) =>
    layoutTentFace(doc, fonts, face, art),
  )
  const placed = panelLayouts(pages, layouts)
  const photoAt = await areaPhotos(doc, input.photo, placed, panelArea, warn)
  const letter = monogramLetter(input.wordmark)
  drawPrintPages(
    { doc, faces: input.faces, warn },
    pages,
    layouts,
    {
      draw: (layout, bleed) =>
        drawTentFace(
          doc,
          fonts,
          layout,
          { photo: photoAt(layout, bleed), letter },
          bleed,
        ),
      logoDpi,
    },
    sheetMarks(doc, fonts, input, art),
  )
}
