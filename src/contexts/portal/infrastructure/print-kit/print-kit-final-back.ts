// The optional back page in the PDF (final design spec §10.4): the logo or the
// wordmark and the property's name, laid out by the shared planner
// (`layoutPrintFinalBack`) from the guest fonts' own glyph outlines, and drawn
// where it put each part's ink. Paper is plain paper; Immersive stands on the
// front's ground and washes, with its grain and no photo. The brand is the
// front's (its plate included), so the two sides agree.
//
// A back is prepared once from its front (`FinalPreparedFace`), the way a face is
// prepared once and drawn in every cell of a sheet, so the page that holds it, a
// print shop's second page or a sheet's reverse, can be added when it is drawn.

import type { PrintFinalRenderInput } from '../../application/ports/portal-print-final-renderer.port'
import { printFinalBackArt } from '#/shared/domain/portal-print-final-art'
import {
  layoutPrintFinalBack,
  type PrintFinalBackLayout,
} from '#/shared/domain/portal-print-final-back'
import type { PrintFinalBrandInput } from '#/shared/domain/portal-print-final-face'
import type { PrintFinalBleed } from '#/shared/domain/portal-print-final-layers'
import type { PrintFinalPlacedPart } from '#/shared/domain/portal-print-final-parts'
import { drawFinalArt, grainTile } from './print-kit-final-art'
import {
  drawLogo,
  drawText,
  finalLogoInkSize,
  pdfFinalMeasurer,
  type FinalFaceLogo,
} from './print-kit-final-face'
import type { FinalPreparedFace } from './print-kit-final-immersive'
import type { PrintKitFonts } from './print-kit-pdf-text'

export type FinalPreparedBack = Readonly<{
  layout: PrintFinalBackLayout
  /** How far its art runs past each trim edge: the front's. */
  bleed: PrintFinalBleed
  /** Draws the back on the current page. */
  draw: () => void
}>

function brandOf(
  input: PrintFinalRenderInput,
  logo: FinalFaceLogo | null,
  onPlate: boolean,
): PrintFinalBrandInput {
  if (logo === null) return { kind: 'wordmark', text: input.wordmark }
  return { kind: 'logo', ...finalLogoInkSize(logo), onPlate }
}

/** Lays a card's back out and paints it, ready to draw once its page is added. */
export function prepareFinalBack(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  input: Readonly<{
    input: PrintFinalRenderInput
    propertyName: string
    front: FinalPreparedFace
    logo: FinalFaceLogo | null
  }>,
): FinalPreparedBack {
  const { front, logo } = input
  const layout = layoutPrintFinalBack({
    face: input.input.face,
    brand: brandOf(input.input, logo, front.look.logoOnPlate),
    propertyName: input.propertyName,
    measurer: pdfFinalMeasurer(doc, fonts),
  })
  const { palette, colours } = front.look
  // A sheet draws one back many times: its grain is made once.
  const art =
    palette === null ? null : printFinalBackArt(layout.plan, palette, front.bleed)
  const grain = art === null ? null : grainTile(doc)
  const drawPart = (part: PrintFinalPlacedPart, index: number): void => {
    const content = layout.contents[index]
    if (content === undefined) return
    switch (content.kind) {
      case 'wordmark':
        return drawText(doc, fonts, content.set, part, colours.ink)
      case 'name':
        return drawText(doc, fonts, content.set, part, colours.soft)
      case 'logo':
        return logo === null ? undefined : drawLogo(doc, logo, content.box, part)
    }
  }
  return {
    layout,
    bleed: front.bleed,
    draw: () => {
      if (art !== null && grain !== null) {
        drawFinalArt(doc, art, { photo: null, grain, scrims: [] })
      }
      layout.plan.parts.forEach(drawPart)
    },
  }
}
