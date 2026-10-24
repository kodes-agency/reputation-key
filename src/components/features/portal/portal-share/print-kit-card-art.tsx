// The Large card, 4 × 6 in or A6, in either style, drawn from the plan the PDF
// draws from (`previewCardPlan`): on Immersive the photo band across the top
// with the cream plate straddling its edge, then the name, the message and the
// code block, every part where the file puts it. Each part is placed absolutely
// from the plan, in container units of the card's width, so it scales with its
// column or its slot on a sheet.
//
// With no photo the band holds the monogram. On a print-shop sheet (`bleedPt`)
// the sheet paints the field into the bleed, and the band runs into it on the
// top and both sides, as in the file.
//
// Inline styles on purpose, as the rest of the print preview's: the first-paint
// stylesheet is built by scanning `src/` for class names, and a measure this
// specific would land in every page's.

import { useState } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type {
  PrintFace,
  PrintKitPaper,
  PrintKitStyle,
} from '#/shared/domain/portal-print-kit'
import type { LargeCardPlan } from '#/shared/domain/portal-print-kit-card'
import { CARD_PLATE } from '#/shared/domain/portal-print-kit-card-brand'
import {
  cardColours,
  type CardColours,
} from '#/shared/domain/portal-print-kit-card-colours'
import type { CardLine, CardRule } from '#/shared/domain/portal-print-kit-card-words'
import { cueLinesFor } from '#/shared/domain/portal-print-kit-code-block'
import type { CodeTile } from '#/shared/domain/portal-print-kit-code-tile'
import {
  IMMERSIVE_LOGO_PLATE,
  PRINT_KIT_PAPER,
  immersivePrintKitPalette,
  paperPrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import { CARD_FONT, cardBox, previewCardPlan } from './print-kit-card-art-layout'
import { PrintKitCardBand } from './print-kit-card-band-art'
import { PrintKitCodeBlock } from './print-kit-code-block'
import type { PointsToLength } from './print-kit-code-block-layout'
import { immersiveBackground } from './print-kit-immersive-art-layout'

type Look = PortalPrintKitView['look']

type Props = Readonly<{
  style: PrintKitStyle
  paper: PrintKitPaper
  face: PrintFace
  look: Look
  codeUrl: string | null
  tile: CodeTile
  /** The bleed a print-shop sheet runs the band into; 0 on a card shown alone, which has its own ground. */
  bleedPt: number
  pt: PointsToLength
}>

/** One planned line, centred in the column; a rule, centred on its own width. */
function Word({
  item,
  column,
  colours,
  pt,
}: Readonly<{
  item: CardLine | CardRule
  column: LargeCardPlan['column']
  colours: CardColours
  pt: PointsToLength
}>) {
  if (item.kind === 'rule') {
    const x = column.x + (column.widthPt - item.widthPt) / 2
    const at = { x, y: item.topPt, widthPt: item.widthPt, heightPt: item.weightPt }
    return <span aria-hidden style={{ ...cardBox(pt, at), background: colours.rule }} />
  }
  const { style } = item
  const at = {
    x: column.x,
    y: item.topPt,
    widthPt: column.widthPt,
    heightPt: item.heightPt,
  }
  return (
    <span
      {...(item.locale === null ? {} : { lang: item.locale })}
      style={{
        ...cardBox(pt, at),
        ...CARD_FONT[style.face],
        fontSize: pt(style.sizePt),
        lineHeight: pt(item.heightPt),
        letterSpacing: `${style.trackingEm}em`,
        // Centred, the tracking after the last letter is balanced on the left.
        paddingLeft: style.trackingEm > 0 ? `${style.trackingEm}em` : 0,
        boxSizing: 'border-box',
        // The file sets a tracked line letter by letter: no ligature joins a TT.
        fontVariantLigatures: style.trackingEm > 0 ? 'none' : 'normal',
        textAlign: 'center',
        whiteSpace: 'nowrap',
        color: colours[item.role],
      }}
    >
      {item.text}
    </span>
  )
}

/** The logo on its plate, or the wordmark's lines. */
function Brand({
  plan,
  look,
  colours,
  onLogoAspect,
  pt,
}: Readonly<{
  plan: LargeCardPlan
  look: Look
  colours: CardColours
  onLogoAspect: (aspect: number) => void
  pt: PointsToLength
}>) {
  const { brand } = plan
  if (brand.kind === 'wordmark') {
    const column = { x: 0, widthPt: plan.widthPt }
    return brand.lines.map((line) => (
      <Word key={line.topPt} item={line} column={column} colours={colours} pt={pt} />
    ))
  }
  if (look.logoUrl === null) return null
  const { shadow } = CARD_PLATE
  return (
    <>
      {brand.plate !== null && (
        <span
          aria-hidden
          style={{
            ...cardBox(pt, brand.plate),
            borderRadius: pt(CARD_PLATE.radiusPt),
            background: IMMERSIVE_LOGO_PLATE,
            boxShadow: `0 ${pt(shadow.offsetYPt)} ${pt(shadow.blurPt)} rgb(0 0 0 / ${shadow.alpha})`,
          }}
        />
      )}
      <img
        src={look.logoUrl}
        alt=""
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget
          if (naturalWidth > 0 && naturalHeight > 0)
            onLogoAspect(naturalWidth / naturalHeight)
        }}
        style={{
          ...cardBox(pt, brand.ink),
          display: 'block',
          maxWidth: 'none',
          objectFit: 'contain',
        }}
      />
    </>
  )
}

export function PrintKitCardArt({
  style,
  paper,
  face,
  look,
  codeUrl,
  tile,
  bleedPt,
  pt,
}: Props) {
  const [logoAspect, setLogoAspect] = useState<number | null>(null)
  const plan = previewCardPlan({ style, paper, face, look, tile, logoAspect })
  const palette =
    style === 'paper'
      ? paperPrintKitPalette(look.accentColour)
      : immersivePrintKitPalette(look.accentColour, look.fieldColour)
  const colours = cardColours(palette)
  const ground =
    palette.style === 'paper' ? PRINT_KIT_PAPER : immersiveBackground(palette)
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        // On a print-shop sheet the band runs into the bleed the sheet painted.
        overflow: bleedPt > 0 ? 'visible' : 'hidden',
        background: bleedPt > 0 ? 'transparent' : ground,
      }}
    >
      {palette.style === 'immersive' && plan.bandPt !== null && (
        <PrintKitCardBand
          plan={{ ...plan, bandPt: plan.bandPt }}
          look={look}
          palette={palette}
          bleedPt={bleedPt}
          pt={pt}
        />
      )}
      <Brand
        plan={plan}
        look={look}
        colours={colours}
        onLogoAspect={setLogoAspect}
        pt={pt}
      />
      {plan.words.map((item) => (
        <Word
          key={`${item.kind}:${item.topPt}`}
          item={item}
          column={plan.column}
          colours={colours}
          pt={pt}
        />
      ))}
      <div style={{ position: 'absolute', left: pt(plan.code.x), top: pt(plan.code.y) }}>
        <PrintKitCodeBlock
          palette={palette}
          cues={cueLinesFor(face.blocks.map((block) => block.locale))}
          codeUrl={codeUrl}
          pt={pt}
          tile={tile}
        />
      </div>
    </div>
  )
}
