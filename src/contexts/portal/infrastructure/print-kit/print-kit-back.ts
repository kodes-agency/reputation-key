// The optional back page in the PDF (design spec §10.4): the logo or the
// wordmark and the property's name, laid out by the shared planner
// (`layoutPrintBack`) from the guest fonts' own glyph outlines, and drawn
// where it put each part's ink. Paper is plain paper; Immersive stands on the
// front's ground and washes, with its grain and no photo. The brand is the
// front's (its plate included), so the two sides agree.
//
// A back is prepared once from its front (`PreparedFace`), the way a face is
// prepared once and drawn in every cell of a sheet, so the page that holds it, a
// print shop's second page or a sheet's reverse, can be added when it is drawn.

import {
  PrintRenderRefusal,
  type PrintRenderInput,
} from '../../application/ports/portal-print-renderer.port'
import { printBackArt } from '#/shared/domain/portal-print-art'
import { layoutPrintBack, type PrintBackLayout } from '#/shared/domain/portal-print-back'
import type { PrintBrandInput } from '#/shared/domain/portal-print-face'
import type { PrintBleed } from '#/shared/domain/portal-print-layers'
import type { PrintPlacedPart } from '#/shared/domain/portal-print-parts'
import { drawArt, grainTile } from './print-kit-art'
import {
  drawLogo,
  drawText,
  logoInkSize,
  pdfMeasurer,
  type FaceLogo,
} from './print-kit-face'
import type { PreparedFace } from './print-kit-immersive'
import type { PrintKitFonts } from './print-kit-pdf-text'

export type PreparedBack = Readonly<{
  layout: PrintBackLayout
  /** How far its art runs past each trim edge: the front's. */
  bleed: PrintBleed
  /** Draws the back on the current page. */
  draw: () => void
}>

function brandOf(
  input: PrintRenderInput,
  logo: FaceLogo | null,
  onPlate: boolean,
): PrintBrandInput {
  if (logo === null) return { kind: 'wordmark', text: input.wordmark }
  return { kind: 'logo', ...logoInkSize(logo), onPlate }
}

/** Lays a card's back out and paints it, ready to draw once its page is added. */
export function prepareBack(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  input: Readonly<{
    input: PrintRenderInput
    propertyName: string
    front: PreparedFace
    logo: FaceLogo | null
  }>,
): PreparedBack {
  const { front, logo } = input
  const layout = layoutPrintBack({
    face: input.input.face,
    brand: brandOf(input.input, logo, front.look.logoOnPlate),
    propertyName: input.propertyName,
    measurer: pdfMeasurer(doc, fonts),
  })
  if (!layout.plan.fits) {
    throw new PrintRenderRefusal({ code: 'words_do_not_fit', moduleMm: null })
  }
  const { palette, colours } = front.look
  // A sheet draws one back many times: its grain is made once.
  const art = palette === null ? null : printBackArt(layout.plan, palette, front.bleed)
  const grain = art === null ? null : grainTile(doc)
  const drawPart = (part: PrintPlacedPart, index: number): void => {
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
        drawArt(doc, art, { photo: null, grain })
      }
      layout.plan.parts.forEach(drawPart)
    },
  }
}
