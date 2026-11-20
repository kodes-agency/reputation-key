// A radio drawn as a card (the share board's Style, Size and Piece cards): a
// picture at the start, the name over what it is, and the radio at the top end.
// The whole card is the radio's label, so it is one target; the checked card wears
// the primary ring and tint, as the section's Piece cards did.
//
// The Style cards' pictures are small thumbnails of the prints themselves, in
// the property's own accent and field, so the choice shows what it will make.
// Inline styles on purpose, as the preview's: a colour this specific would
// otherwise reach the first-paint stylesheet.

import type { ReactNode } from 'react'
import { Label } from '#/components/ui/label'
import { RadioGroupItem } from '#/components/ui/radio-group'

type CardProps = Readonly<{
  id: string
  value: string
  title: string
  /** After the title, lighter: "Large · 4 × 6 in" has "4 × 6 in" here. */
  qualifier?: string
  detail: string
  /** The picture at the start: decorative, the title and detail name the card. */
  art: ReactNode
}>

export function PrintKitChoiceCard({
  id,
  value,
  title,
  qualifier,
  detail,
  art,
}: CardProps) {
  return (
    <Label
      htmlFor={id}
      className="relative flex min-h-20 cursor-pointer items-start gap-3 rounded-md border p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
    >
      {art}
      <span className="flex flex-col gap-0.5 pr-5">
        <span className="text-[13px] leading-[18px] font-medium">
          {title}
          {qualifier !== undefined && (
            <>
              {/* The space is outside the span: an accessible name trims each inline child. */}{' '}
              <span className="font-normal text-muted-foreground">· {qualifier}</span>
            </>
          )}
        </span>
        <span className="text-xs leading-4 text-pretty text-muted-foreground">
          {detail}
        </span>
      </span>
      <RadioGroupItem value={value} id={id} className="absolute top-3 right-3" />
    </Label>
  )
}
