// The Large card's band in the Share tab's preview (round-2 spec-delta R1): the
// property's photo cropped round its focal point, or with no photo the monogram,
// the brand's first letter tone on tone between two rules, measured as the PDF
// draws it (`CARD_BAND_MONOGRAM`). It runs `bleedPt` past the trim on the top
// and both sides, into the bleed a print-shop sheet paints.

import type { CSSProperties } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { LargeCardPlan } from '#/shared/domain/portal-print-kit-card'
import { CARD_BAND_MONOGRAM } from '#/shared/domain/portal-print-kit-card-brand'
import { monogramLetter } from '#/shared/domain/portal-print-kit-immersive'
import type { ImmersivePrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import { CARD_FONT, cardBox } from './print-kit-card-art-layout'
import type { PointsToLength } from './print-kit-code-block-layout'

type Look = PortalPrintKitView['look']

/** The band: the photo, or the monogram on its ground, run `bleedPt` past the top and both sides. */
export function PrintKitCardBand({
  plan,
  look,
  palette,
  bleedPt,
  pt,
}: Readonly<{
  plan: LargeCardPlan & Readonly<{ bandPt: number }>
  look: Look
  palette: ImmersivePrintKitPalette
  bleedPt: number
  pt: PointsToLength
}>) {
  const area = {
    x: -bleedPt,
    y: -bleedPt,
    widthPt: plan.widthPt + 2 * bleedPt,
    heightPt: plan.bandPt + bleedPt,
  }
  if (look.heroUrl !== null) {
    const focal = look.heroFocal ?? { x: 0.5, y: 0.5 }
    return (
      <img
        data-print-band
        src={look.heroUrl}
        alt=""
        style={{
          ...cardBox(pt, area),
          display: 'block',
          // Wider than the card by its bleed: the base stylesheet caps a picture at its container's width.
          maxWidth: 'none',
          objectFit: 'cover',
          objectPosition: `${focal.x * 100}% ${focal.y * 100}%`,
        }}
      />
    )
  }
  const monogram = CARD_BAND_MONOGRAM
  const rule: CSSProperties = {
    flex: 'none',
    width: pt(monogram.ruleLengthPt),
    height: pt(monogram.ruleWeightPt),
    background: palette.monoLine,
  }
  const letter = monogramLetter(look.wordmark)
  return (
    <div
      aria-hidden
      data-print-band
      style={{ ...cardBox(pt, area), background: palette.plateTone }}
    >
      {/* The letter is centred on the band as it is trimmed, not on its bleed. */}
      <div
        style={{
          ...cardBox(pt, {
            x: bleedPt,
            y: bleedPt,
            widthPt: plan.widthPt,
            heightPt: plan.bandPt,
          }),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: pt(monogram.gapPt),
        }}
      >
        <span style={rule} />
        {letter !== '' && (
          <span
            style={{
              ...CARD_FONT.display,
              fontSize: pt(monogram.letterShare * plan.bandPt),
              lineHeight: 1,
              color: palette.mono,
              transform: `translateY(${monogram.dropEm}em)`,
            }}
          >
            {letter}
          </span>
        )}
        <span style={rule} />
      </div>
    </div>
  )
}
