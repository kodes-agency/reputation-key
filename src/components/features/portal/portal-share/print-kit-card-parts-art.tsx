// The parts a card's face and a small tent's face are drawn from, in the Share
// tab's preview: one planned line of words (centred in its column on a card, set
// from the column's left edge on the tent) and the brand, the logo on its plate
// or the wordmark's lines. Each part is placed absolutely from the plan, in the
// container units of the face's width.
//
// Inline styles on purpose, as the rest of the print preview's: the first-paint
// stylesheet is built by scanning `src/` for class names, and a measure this
// specific would land in every page's.

import type { ReactNode } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { PrintKitStyle } from '#/shared/domain/portal-print-kit'
import { CARD_PLATE, type CardBrand } from '#/shared/domain/portal-print-kit-card-brand'
import {
  cardColours,
  type CardColours,
} from '#/shared/domain/portal-print-kit-card-colours'
import type { CardLine, CardRule } from '#/shared/domain/portal-print-kit-card-words'
import {
  IMMERSIVE_LOGO_PLATE,
  PRINT_KIT_PAPER,
  immersivePrintKitPalette,
  paperPrintKitPalette,
  type PrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import { CARD_FONT, cardBox } from './print-kit-card-art-layout'
import type { PointsToLength } from './print-kit-code-block-layout'
import { immersiveBackground } from './print-kit-immersive-art-layout'

/** The palette a style draws a face in, the colour of each part of its words, and the ground it stands on. */
export function faceLook(
  style: PrintKitStyle,
  look: PortalPrintKitView['look'],
): Readonly<{ palette: PrintKitPalette; colours: CardColours; ground: string }> {
  const palette =
    style === 'paper'
      ? paperPrintKitPalette(look.accentColour)
      : immersivePrintKitPalette(look.accentColour, look.fieldColour)
  return {
    palette,
    colours: cardColours(palette),
    ground: palette.style === 'paper' ? PRINT_KIT_PAPER : immersiveBackground(palette),
  }
}

/**
 * The face's own ground, filling its container. On a print-shop or office sheet the
 * sheet has painted the field into the bleed (`bare`), so the face has none and lets
 * its photo run past its trim.
 */
export function FaceCanvas({
  ground,
  bare,
  children,
}: Readonly<{ ground: string; bare: boolean; children: ReactNode }>) {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: bare ? 'visible' : 'hidden',
        background: bare ? 'transparent' : ground,
      }}
    >
      {children}
    </div>
  )
}

/** How the words sit in their column: centred on a card, from its left edge on the small tent. */
export type WordsAlign = 'centre' | 'left'

type Column = Readonly<{ x: number; widthPt: number }>

/** One planned line in the column; a rule, centred on its own width, or from the column's left edge. */
export function Word({
  item,
  column,
  align = 'centre',
  colours,
  pt,
}: Readonly<{
  item: CardLine | CardRule
  column: Column
  align?: WordsAlign
  colours: CardColours
  pt: PointsToLength
}>) {
  const centred = align === 'centre'
  if (item.kind === 'rule') {
    const x = centred ? column.x + (column.widthPt - item.widthPt) / 2 : column.x
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
        paddingLeft: centred && style.trackingEm > 0 ? `${style.trackingEm}em` : 0,
        boxSizing: 'border-box',
        // The file sets a tracked line letter by letter: no ligature joins a TT.
        fontVariantLigatures: style.trackingEm > 0 ? 'none' : 'normal',
        textAlign: centred ? 'center' : 'left',
        whiteSpace: 'nowrap',
        color: colours[item.role],
      }}
    >
      {item.text}
    </span>
  )
}

/** The logo on its plate, or the wordmark's lines in `column`. */
export function Brand({
  brand,
  column,
  align = 'centre',
  look,
  colours,
  onLogoAspect,
  pt,
}: Readonly<{
  brand: CardBrand
  column: Column
  align?: WordsAlign
  look: PortalPrintKitView['look']
  colours: CardColours
  onLogoAspect: (aspect: number) => void
  pt: PointsToLength
}>) {
  if (brand.kind === 'wordmark') {
    return brand.lines.map((line) => (
      <Word
        key={line.topPt}
        item={line}
        column={column}
        align={align}
        colours={colours}
        pt={pt}
      />
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
