// The brand at the head of a face, as the PDF sets it (spec 2.1 and
// 2.5): the property's logo when it has one, else its wordmark in tracked
// capitals, ink on Paper and white on the Immersive field.
//
// Margins are optical, as in the PDF: a face pads its top by the margin less the
// distance from the brand's box to its ink. The preview cannot read a logo's
// alpha, so it takes the boards' 1.2 mm edge.

import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import { stripUnsupportedCharacters } from '#/shared/domain/portal-print-kit-font-ranges'
import {
  LOGO_BOX_MM,
  MARGIN,
  TENT_FACE,
  WORDMARK,
  mmToPt,
} from '#/shared/domain/portal-print-kit-measures'
import { LINING_FIGURES } from './print-kit-art-layout'
import type { PointsToLength } from './print-kit-code-block-layout'

type Props = Readonly<{
  look: PortalPrintKitView['look']
  /** The wordmark's colour. */
  colour: string
  wordmarkPt: number
  logoHeightPt: number
  /** Centred on a card or panel; from the left, with the logo's edge cancelled, on the Paper tent face. */
  align: 'centre' | 'start'
  pt: PointsToLength
}>

export function PrintKitFaceBrand({
  look,
  colour,
  wordmarkPt,
  logoHeightPt,
  align,
  pt,
}: Props) {
  if (look.logoUrl !== null) {
    return (
      <img
        src={look.logoUrl}
        alt=""
        style={{
          display: 'block',
          flex: 'none',
          alignSelf: align === 'centre' ? 'center' : 'flex-start',
          height: pt(logoHeightPt),
          width: 'auto',
          maxWidth: pt(mmToPt(LOGO_BOX_MM.width)),
          objectFit: 'contain',
          // The logo's transparent edge, cancelled optically on the tent (spec 4.4).
          marginLeft: align === 'start' ? pt(TENT_FACE.logoShiftPt) : 0,
        }}
      />
    )
  }
  return (
    <p
      style={{
        margin: 0,
        flex: 'none',
        fontFamily: 'var(--font-guest-display)',
        fontWeight: 600,
        ...LINING_FIGURES,
        fontSize: pt(wordmarkPt),
        lineHeight: WORDMARK.lineBoxEm,
        letterSpacing: `${WORDMARK.trackingEm}em`,
        // Centred, the tracking after the last letter is balanced on the left.
        paddingLeft: align === 'centre' ? `${WORDMARK.trackingEm}em` : 0,
        textTransform: 'uppercase',
        // The file sets a tracked line letter by letter: no ligature joins a TT.
        fontVariantLigatures: 'none',
        whiteSpace: 'nowrap',
        color: colour,
      }}
    >
      {stripUnsupportedCharacters(look.wordmark)}
    </p>
  )
}

/** Where a brand's ink starts inside its box: a logo's transparent edge, or the wordmark's cap line. */
export const brandInkPt = (
  look: PortalPrintKitView['look'],
  wordmarkPt: number,
): number =>
  look.logoUrl !== null
    ? MARGIN.optical.logoEdgePt
    : (MARGIN.optical.wordmarkCapPt * wordmarkPt) / WORDMARK.pt
