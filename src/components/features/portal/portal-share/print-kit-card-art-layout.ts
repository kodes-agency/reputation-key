// The Large card in the Share tab's preview, planned by the function the PDF
// draws from (`planLargeCard`, round-2 spec-delta R1 and R2, round-3 S3): the
// same groups, gaps, band and fit steps, measured from the width tables the
// preview estimates with (`portal-print-kit-text-widths.ts`), since it cannot
// measure the fonts. The estimates err wide, so the preview takes a fit step no
// later than the file does and never sets a line larger.
//
// The tile is the one the file prints on: 1.75 in when the address's modules
// allow it, else today's 2 in (`largeCardTile`). The preview cannot read a
// logo's alpha, so its drawing is the whole image, and on Paper it never sits on
// a plate. The card's parts share the box and font helpers below.

import type { CSSProperties } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type {
  PrintFace,
  PrintKitPaper,
  PrintKitStyle,
} from '#/shared/domain/portal-print-kit'
import {
  largeCardTile,
  planLargeCard,
  type LargeCardPlan,
} from '#/shared/domain/portal-print-kit-card'
import type { CardTextFace } from '#/shared/domain/portal-print-kit-card-words'
import {
  cueLinesFor,
  estimatedCueWidthPt,
  planCodeBlock,
} from '#/shared/domain/portal-print-kit-code-block'
import {
  CODE_TILE,
  TODAY_CODE_TILE,
  printAddressShape,
  type CodeTile,
} from '#/shared/domain/portal-print-kit-code-tile'
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
 * The tile the card's code is drawn on: the file's, from the drawn symbol's
 * modules. Before the symbol is drawn, the address's shape stands in for them: a
 * short print address takes 1.75 in, and a long one (version 8 or more) today's
 * 2 in.
 */
export function previewCardTile(
  paper: PrintKitPaper,
  address: string,
  symbolModules: number | null,
): CodeTile {
  if (symbolModules !== null)
    return largeCardTile(paper, { text: address, symbolModules })
  return printAddressShape(address) === 'short' ? CODE_TILE.large[paper] : TODAY_CODE_TILE
}

export type PreviewCardInput = Readonly<{
  style: PrintKitStyle
  paper: PrintKitPaper
  face: PrintFace
  look: PortalPrintKitView['look']
  tile: CodeTile
  /** The logo picture's width over its height, once it has loaded. */
  logoAspect: number | null
}>

/** Where everything on a Large card goes, as the file places it. */
export function previewCardPlan(input: PreviewCardInput): LargeCardPlan {
  const { style, paper, face, look } = input
  const cues = cueLinesFor(face.blocks.map((block) => block.locale))
  return planLargeCard({
    style,
    paper,
    face,
    brand:
      look.logoUrl === null
        ? { kind: 'wordmark', text: look.wordmark }
        : {
            kind: 'logo',
            inkAspect: input.logoAspect ?? PREVIEW_LOGO_ASPECT,
            plate: style === 'immersive',
          },
    propertyName: look.propertyName,
    code: planCodeBlock(cues, estimatedCueWidthPt, input.tile),
    measure: (text, textStyle) =>
      estimatedLineWidthPt(
        text,
        estimatedFaceOf(textStyle.face),
        textStyle.sizePt,
        textStyle.trackingEm,
      ),
    // The boards' cap line: 0.3 mm under the box at the 16 pt wordmark, in proportion.
    wordmarkInkTopPt: (sizePt) => (MARGIN.optical.wordmarkCapPt * sizePt) / WORDMARK.pt,
  })
}
