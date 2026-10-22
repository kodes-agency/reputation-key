// A radio drawn as a card (the share board's Style and Piece cards): a picture
// at the start, the name over what it is, and the radio at the top end. The whole
// card is the radio's label, so it is one target; the checked card wears the
// primary ring and tint, as the section's Piece cards did.
//
// The Style cards' pictures are small thumbnails of the prints themselves, in
// the property's own accent and field, so the choice shows what it will make.
// Inline styles on purpose, as the preview's: a colour this specific would
// otherwise reach the first-paint stylesheet.

import type { ReactNode } from 'react'
import { Label } from '#/components/ui/label'
import { RadioGroupItem } from '#/components/ui/radio-group'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { PrintKitStyle } from '#/shared/domain/portal-print-kit'
import {
  PRINT_KIT_INK,
  PRINT_KIT_PAPER,
  PRINT_KIT_TILE,
  printKitStylePalette,
} from '#/shared/domain/portal-print-kit-palette'

type CardProps = Readonly<{
  id: string
  value: string
  title: string
  detail: string
  /** The picture at the start: decorative, the title and detail name the card. */
  art: ReactNode
}>

export function PrintKitChoiceCard({ id, value, title, detail, art }: CardProps) {
  return (
    <Label
      htmlFor={id}
      className="relative flex min-h-20 cursor-pointer items-start gap-3 rounded-md border p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
    >
      {art}
      <span className="flex flex-col gap-0.5 pr-5">
        <span className="text-[13px] leading-[18px] font-medium">{title}</span>
        <span className="text-xs leading-4 text-pretty text-muted-foreground">
          {detail}
        </span>
      </span>
      <RadioGroupItem value={value} id={id} className="absolute top-3 right-3" />
    </Label>
  )
}

/** A stylised code: three finders and a scatter of modules, as the board draws it. */
function CodeGlyph() {
  return (
    <svg viewBox="0 0 18 18" width={14} height={14} style={{ display: 'block' }}>
      <rect width="18" height="18" fill={PRINT_KIT_TILE} />
      <g fill={PRINT_KIT_INK}>
        <path d="M2 2h5v5H2zM11 2h5v5h-5zM2 11h5v5H2z" />
        <path d="M9 9h2v2H9zM12 10h2v2h-2zM10 13h2v2h-2zM14 13h2v3h-2zM9 3h1v2H9z" />
      </g>
      <g fill={PRINT_KIT_TILE}>
        <path d="M3 3h3v3H3zM12 3h3v3h-3zM3 12h3v3H3z" />
      </g>
      <g fill={PRINT_KIT_INK}>
        <path d="M4 4h1v1H4zM13 4h1v1h-1zM4 13h1v1H4z" />
      </g>
    </svg>
  )
}

/** The code's tile with its bar under it, outlined on Paper alone. */
function Tile({ bar, outline }: Readonly<{ bar: string; outline: string | null }>) {
  return (
    <span
      style={{
        width: 18,
        height: 22,
        marginTop: 3,
        borderRadius: 2,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: outline === null ? undefined : `0 0 0 1px ${outline}`,
      }}
    >
      <span
        style={{
          flex: 1,
          background: PRINT_KIT_TILE,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CodeGlyph />
      </span>
      <span style={{ height: 4, background: bar }} />
    </span>
  )
}

const THUMBNAIL = {
  flex: 'none',
  width: 34,
  height: 48,
  boxSizing: 'border-box',
  borderRadius: 2,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 3,
} as const

/** What a Paper print is: unprinted paper, an ink line for the brand, the code. */
function PaperThumbnail({ accent }: Readonly<{ accent: string }>) {
  const palette = printKitStylePalette(accent, null, 'paper')
  return (
    <span
      aria-hidden
      style={{ ...THUMBNAIL, background: PRINT_KIT_PAPER, paddingTop: 6 }}
    >
      <span style={{ width: 16, height: 2, borderRadius: 1, background: palette.ink }} />
      <Tile bar={palette.barFill} outline={palette.accentInk} />
    </span>
  )
}

/** What an Immersive print is: the dark field, a framed photograph, the code. */
function ImmersiveThumbnail({
  accent,
  field,
}: Readonly<{ accent: string; field: string }>) {
  const palette = printKitStylePalette(accent, field, 'immersive')
  return (
    <span aria-hidden style={{ ...THUMBNAIL, background: palette.field, paddingTop: 4 }}>
      <span
        style={{
          width: 26,
          height: 8,
          boxSizing: 'border-box',
          borderRadius: 1.5,
          border: `1px solid ${palette.accentLine}`,
          // A photograph's stand-in in the property's own colours: a sky, a dark foreground.
          background: `linear-gradient(${palette.accentInk}, ${palette.accentLine} 60%, ${palette.plateTone} 61%)`,
        }}
      />
      <Tile bar={palette.barFill} outline={null} />
    </span>
  )
}

export function PrintKitStyleThumbnail({
  style,
  look,
}: Readonly<{ style: PrintKitStyle; look: PortalPrintKitView['look'] }>) {
  return style === 'paper' ? (
    <PaperThumbnail accent={look.accentColour} />
  ) : (
    <ImmersiveThumbnail accent={look.accentColour} field={look.fieldColour} />
  )
}
