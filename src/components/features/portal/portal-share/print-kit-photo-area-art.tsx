// The photo area of an Immersive face in the Share tab's preview (round-2
// spec-delta R1, round-3 S5): a card's band across the top, or a small tent's
// panel down the left. The property's photo cropped round its focal point, or
// with no photo the monogram, the brand's first letter tone on tone between two
// rules, measured as the PDF draws it (`CARD_BAND_MONOGRAM`, and
// `tentPanelMonogram` for the panel). The area runs into the bleed a print-shop
// sheet paints, on each edge the face bleeds.

import type { CSSProperties } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { CardBox } from '#/shared/domain/portal-print-kit-card-brand'
import { monogramLetter } from '#/shared/domain/portal-print-kit-immersive'
import type { ImmersivePrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import type { PanelBleed } from '#/shared/domain/portal-print-kit-sheets'
import { CARD_FONT, cardBox } from './print-kit-card-art-layout'
import type { PointsToLength } from './print-kit-code-block-layout'

type Look = PortalPrintKitView['look']

/** The monogram's measures: the band's, or the panel's. */
export type MonogramMeasures = Readonly<{
  letterShare: number
  ruleLengthPt: number
  ruleWeightPt: number
  gapPt: number
  dropEm: number
}>

/**
 * The area as it is trimmed (`trimmed`, in the face's own points from its trim's
 * top-left corner) with its bleed past each edge (`bleed`): the photo, or the
 * monogram on its ground. The letter is centred on the area as it is trimmed,
 * not on its bleed.
 */
export function PrintKitPhotoArea({
  trimmed,
  bleed,
  look,
  palette,
  monogram,
  pt,
}: Readonly<{
  trimmed: CardBox
  bleed: PanelBleed
  look: Look
  palette: ImmersivePrintKitPalette
  monogram: MonogramMeasures
  pt: PointsToLength
}>) {
  const area = {
    x: trimmed.x - bleed.leftPt,
    y: trimmed.y - bleed.topPt,
    widthPt: trimmed.widthPt + bleed.leftPt + bleed.rightPt,
    heightPt: trimmed.heightPt + bleed.topPt + bleed.bottomPt,
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
          // Wider than the face by its bleed: the base stylesheet caps a picture at its container's width.
          maxWidth: 'none',
          objectFit: 'cover',
          objectPosition: `${focal.x * 100}% ${focal.y * 100}%`,
        }}
      />
    )
  }
  const rule: CSSProperties = {
    flex: 'none',
    width: pt(monogram.ruleLengthPt),
    height: pt(monogram.ruleWeightPt),
    background: palette.monoLine,
  }
  const letter = monogramLetter(look.wordmark)
  const hasRules = monogram.ruleLengthPt > 0
  return (
    <div
      aria-hidden
      data-print-band
      style={{ ...cardBox(pt, area), background: palette.plateTone }}
    >
      <div
        style={{
          ...cardBox(pt, {
            x: bleed.leftPt,
            y: bleed.topPt,
            widthPt: trimmed.widthPt,
            heightPt: trimmed.heightPt,
          }),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: pt(monogram.gapPt),
        }}
      >
        {hasRules && <span style={rule} />}
        {letter !== '' && (
          <span
            style={{
              ...CARD_FONT.display,
              fontSize: pt(monogram.letterShare * trimmed.heightPt),
              lineHeight: 1,
              color: palette.mono,
              transform: `translateY(${monogram.dropEm}em)`,
            }}
          >
            {letter}
          </span>
        )}
        {hasRules && <span style={rule} />}
      </div>
    </div>
  )
}
