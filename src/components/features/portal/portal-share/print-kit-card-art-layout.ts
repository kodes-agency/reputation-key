// A card of any size in the Share tab's preview, planned by the function the PDF
// draws from (`planCard`, round-2 spec-delta R1 and R2, round-3 S3): the same
// groups, gaps, band and fit steps, measured from the width tables the preview
// estimates with (`portal-print-kit-text-widths.ts`), since it cannot measure
// the fonts. The estimates err wide, so the preview takes a fit step no later
// than the file does and never sets a line larger.
//
// The tile is the one the file prints on (`printKitTile`): Large's 1.75 in when
// the address's modules allow it, else today's 2 in; Table's and Mini's own, or
// a refusal when the address is too long for them, which the preview says in
// words instead of drawing a card the file would not print. The preview cannot
// read a logo's alpha, so its drawing is the whole image, and on Paper it never
// sits on a plate. The card's parts share the box and font helpers below.

import type { CSSProperties } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type {
  PrintFace,
  PrintKitPaper,
  PrintKitPiece,
  PrintKitSize,
  PrintKitStyle,
} from '#/shared/domain/portal-print-kit'
import { planCard, type CardPlan } from '#/shared/domain/portal-print-kit-card'
import type {
  CardTextFace,
  CardTextMeasure,
} from '#/shared/domain/portal-print-kit-card-words'
import {
  cueLinesFor,
  estimatedCueWidthPt,
  planCodeBlock,
} from '#/shared/domain/portal-print-kit-code-block'
import {
  printAddressShape,
  printKitTile,
  type CodeTile,
  type CodeTileChoice,
  type PrintCodeTooSmall,
} from '#/shared/domain/portal-print-kit-code-tile'
import type { Result } from '#/shared/domain/result'
import { MARGIN, WORDMARK } from '#/shared/domain/portal-print-kit-measures'
import {
  estimatedLineWidthPt,
  type EstimatedFace,
} from '#/shared/domain/portal-print-kit-text-widths'
import { LINING_FIGURES } from './print-kit-art-layout'
import type { PointsToLength } from './print-kit-code-block-layout'

/** How each face the card sets is asked for in CSS. */
export const CARD_FONT: Readonly<Record<CardTextFace, CSSProperties>> = {
  display: {
    fontFamily: 'var(--font-guest-display)',
    fontWeight: 600,
    ...LINING_FIGURES,
  },
  bodyStrong: { fontFamily: 'var(--font-guest-body)', fontWeight: 600 },
  body: { fontFamily: 'var(--font-guest-body)', fontWeight: 400 },
}

/** A planned box, absolutely placed in the card's container units. */
export const cardBox = (
  pt: PointsToLength,
  at: Readonly<{ x: number; y: number; widthPt: number; heightPt: number }>,
): CSSProperties => ({
  position: 'absolute',
  left: pt(at.x),
  top: pt(at.y),
  width: pt(at.widthPt),
  height: pt(at.heightPt),
})

/** A wide badge's proportions, which a logo is planned at until its picture has loaded. */
const PREVIEW_LOGO_ASPECT = 2

const estimatedFaceOf = (face: CardTextFace): EstimatedFace =>
  face === 'display' ? 'display' : 'text'

/**
 * The symbol's modules before it is drawn: a short print address is a version 3
 * symbol (29 modules across), and the long address the beta prints today is
 * version 9 (53). Only the first paint uses them; the drawn symbol replaces them.
 */
const ASSUMED_MODULES = { short: 29, long: 53 } as const

/**
 * The tile a piece's code is drawn on: the file's, from the drawn symbol's
 * modules. Before the symbol is drawn, the address's shape stands in for them. A
 * Table or Mini piece whose tile would print the address too small is refused,
 * as the file refuses it.
 */
export function previewTile(
  piece: PrintKitPiece,
  size: PrintKitSize,
  paper: PrintKitPaper,
  address: string,
  symbolModules: number | null,
): Result<CodeTileChoice, PrintCodeTooSmall> {
  const addressShape = printAddressShape(address)
  return printKitTile(piece, {
    size,
    paper,
    symbolModules: symbolModules ?? ASSUMED_MODULES[addressShape],
    addressShape,
  })
}

export type PreviewCardInput = Readonly<{
  size: PrintKitSize
  style: PrintKitStyle
  paper: PrintKitPaper
  face: PrintFace
  look: PortalPrintKitView['look']
  tile: CodeTile
  /** The logo picture's width over its height, once it has loaded. */
  logoAspect: number | null
  /** The property's name under a logo, which the manager may turn off; on when left out. */
  showPropertyName?: boolean
}>

/** Where everything on a card goes, as the file places it. */
export function previewCardPlan(input: PreviewCardInput): CardPlan {
  const { size, style, paper, face, look } = input
  const cues = cueLinesFor(face.blocks.map((block) => block.locale))
  return planCard({
    size,
    style,
    paper,
    face,
    brand: previewBrandInput(look, style, input.logoAspect),
    propertyName: input.showPropertyName === false ? null : look.propertyName,
    code: planCodeBlock(cues, estimatedCueWidthPt, input.tile),
    ...previewMeasures,
  })
}

/** The brand a face is planned with: the logo (on a plate on Immersive), or the wordmark. */
export const previewBrandInput = (
  look: PortalPrintKitView['look'],
  style: PrintKitStyle,
  logoAspect: number | null,
) =>
  look.logoUrl === null
    ? ({ kind: 'wordmark', text: look.wordmark } as const)
    : ({
        kind: 'logo',
        inkAspect: logoAspect ?? PREVIEW_LOGO_ASPECT,
        plate: style === 'immersive',
      } as const)

/** How the preview measures a line without the fonts, and where a wordmark's caps start. */
export const previewMeasures: Readonly<{
  measure: CardTextMeasure
  wordmarkInkTopPt: (sizePt: number) => number
}> = {
  measure: (text, textStyle) =>
    estimatedLineWidthPt(
      text,
      estimatedFaceOf(textStyle.face),
      textStyle.sizePt,
      textStyle.trackingEm,
    ),
  // The boards' cap line: 0.3 mm under the box at the 16 pt wordmark, in proportion.
  wordmarkInkTopPt: (sizePt: number) =>
    (MARGIN.optical.wordmarkCapPt * sizePt) / WORDMARK.pt,
}
