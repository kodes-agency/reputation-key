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
import { BAND_PHOTO_DPI } from '#/shared/domain/portal-print-kit-sizes'
import type { PrintKitRenderInput } from '../../application/ports/portal-print-kit-renderer.port'
import { cardArtOf, logoDpi, sheetMarks } from './print-kit-card-print'
import { bandPhotoJpeg } from './print-kit-image'
import {
  drawPrintPages,
  layoutFaces,
  panelLayouts,
  type FaceBleed,
  type FaceLayouts,
  type PrintKitWarning,
} from './print-kit-pages'
import type { OpenedImage } from './print-kit-pdf-image'
import { cropPhotoOnce } from './print-kit-photo-crops'
import type { PrintKitFonts } from './print-kit-pdf-text'
import { drawTentFace, layoutTentFace, type TentFaceLayout } from './print-kit-tent-face'

type Warn = (warning: PrintKitWarning) => void

/** A panel's size with its bleed, to the hundredth of a point: panels of one size share a crop. */
const panelKey = (layout: TentFaceLayout, bleed: FaceBleed): string | null =>
  layout.plan.panelPt === null
    ? null
    : `${(layout.plan.panelPt + bleed.leftPt).toFixed(2)}x${(layout.plan.heightPt + bleed.topPt + bleed.bottomPt).toFixed(2)}`

/**
 * The photo cropped for the panel each face has on the pages, with its bleed,
 * each embedded once; under 200 dpi it is reported and under 120 dpi refused,
 * as a card's band is.
 */
function panelPhotos(
  doc: PDFKit.PDFDocument,
  input: PrintKitRenderInput,
  placed: ReturnType<typeof panelLayouts<TentFaceLayout>>,
  warn: Warn,
): Promise<ReadonlyMap<string, OpenedImage>> {
  const { photo } = input
  if (photo === null) return Promise.resolve(new Map())
  return cropPhotoOnce(
    doc,
    placed,
    ({ panel, layout }) => {
      const key = panelKey(layout, panel.bleed)
      const { panelPt, heightPt } = layout.plan
      if (key === null || panelPt === null) return null
      const crop = () =>
        bandPhotoJpeg(photo.bytes, {
          widthPt: panelPt + panel.bleed.leftPt,
          heightPt: heightPt + panel.bleed.topPt + panel.bleed.bottomPt,
          focalX: photo.focalX,
          focalY: photo.focalY,
        })
      return { key, crop }
    },
    warn,
    { warnBelow: BAND_PHOTO_DPI.warnBelow, refuseBelow: BAND_PHOTO_DPI.refuseBelow },
  )
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
  const photos = await panelPhotos(doc, input, panelLayouts(pages, layouts), warn)
  const letter = monogramLetter(input.wordmark)
  drawPrintPages(
    { doc, faces: input.faces, warn },
    pages,
    layouts,
    {
      draw: (layout, bleed) => {
        const key = panelKey(layout, bleed)
        const photo = key === null ? null : (photos.get(key) ?? null)
        drawTentFace(doc, fonts, layout, { photo, letter }, bleed)
      },
      logoDpi,
    },
    sheetMarks(doc, fonts, input, art),
  )
}
