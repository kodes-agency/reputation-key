// The small pictures on the final Print cards section's radio cards (the boards
// share-desktop-light and share-desktop-dark): each piece drawn in its current
// orientation at one scale, the chosen one in the chosen look; and each look as
// a little wide card. They are decorative: each card's title and line name it.
// Inline styles on purpose, as the preview's: a colour or size this specific
// would otherwise reach the first-paint stylesheet.

import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type {
  PrintFinalLook,
  PrintFinalOrientation,
  PrintFinalPiece,
} from '#/shared/domain/portal-print-final'
import { PRINT_FINAL_MEASURES } from '#/shared/domain/portal-print-final-measures'
import {
  PRINT_KIT_INK,
  PRINT_KIT_PAPER,
  PRINT_KIT_TILE,
  immersivePrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'

/** Pixels to the inch on the piece cards; the Counter card is drawn at 0.8 of it, as the board does, so all three fit one row. */
const PX_PER_INCH = 9
const COUNTER_SCALE = 0.8

/** The look's ground on a thumbnail: unprinted paper, or the property's field fading from its accent. */
function groundOf(look: PrintFinalLook, colours: PortalPrintKitView['look']): string {
  if (look === 'paper') return PRINT_KIT_PAPER
  const palette = immersivePrintKitPalette(colours.accentColour, colours.fieldColour)
  return `linear-gradient(180deg, ${palette.accentLine} 0%, ${palette.field} 72%)`
}

type PieceProps = Readonly<{
  piece: PrintFinalPiece
  orientation: PrintFinalOrientation
  look: PrintFinalLook
  selected: boolean
  colours: PortalPrintKitView['look']
}>

/** A piece at the cards' shared scale, its code where it prints: at the foot upright, at the right wide. */
export function PrintFinalPieceThumbnail({
  piece,
  orientation,
  look,
  selected,
  colours,
}: PieceProps) {
  const { shortPt, longPt } = PRINT_FINAL_MEASURES.us[piece]
  const scale = (PX_PER_INCH * (piece === 'counter' ? COUNTER_SCALE : 1)) / 72
  const [width, height] =
    orientation === 'upright'
      ? [shortPt * scale, longPt * scale]
      : [longPt * scale, shortPt * scale]
  const code = Math.round(Math.min(width, height) * 0.42)
  const upright = orientation === 'upright'
  return (
    <span
      aria-hidden
      style={{
        position: 'relative',
        display: 'block',
        width,
        height,
        borderRadius: 1.5,
        background: selected ? groundOf(look, colours) : 'var(--muted)',
        boxShadow:
          selected && look === 'immersive' ? undefined : 'inset 0 0 0 1px var(--border)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          width: code,
          height: code,
          borderRadius: 1,
          background: selected && look === 'paper' ? PRINT_KIT_INK : PRINT_KIT_TILE,
          ...(upright
            ? { left: '50%', bottom: 3, transform: 'translateX(-50%)' }
            : { right: 3, top: '50%', transform: 'translateY(-50%)' }),
        }}
      />
    </span>
  )
}

/** A look as a little wide card: its ground and its code. */
export function PrintFinalLookThumbnail({
  look,
  colours,
}: Readonly<{ look: PrintFinalLook; colours: PortalPrintKitView['look'] }>) {
  const paper = look === 'paper'
  return (
    <span
      aria-hidden
      style={{
        position: 'relative',
        display: 'block',
        flex: 'none',
        width: 26,
        height: 17,
        borderRadius: 2,
        background: paper
          ? PRINT_KIT_PAPER
          : groundOf('immersive', colours).replace('180deg', '90deg'),
        boxShadow: paper ? 'inset 0 0 0 1px var(--border)' : undefined,
      }}
    >
      <span
        style={{
          position: 'absolute',
          right: 3,
          top: 3,
          width: 9,
          height: 9,
          background: paper ? PRINT_KIT_INK : PRINT_KIT_TILE,
        }}
      />
    </span>
  )
}
