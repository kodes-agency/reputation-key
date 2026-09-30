// A fact: plain 13 px text, usually with a glyph, and NO box — one member of a
// `ButtonGroup` that has nothing to press. Hoisted from the inbox case toolbar
// (`inbox/inbox-case-member.tsx`) so the portal workspace header can print its
// own facts (`● Live · version 5`) in the same clothes.
//
// Why not the `ButtonGroupText` look. That primitive draws `rounded-md border
// bg-muted shadow-xs text-sm font-medium` (`ui/button-group.tsx`), and beside an
// outlined control at 390 px the two measured a fill contrast of 1.05:1 (light)
// and 1.09:1 (dark): a fact and a control were the same square. A fact is
// `ButtonGroupText` with the box taken off.
import { cn } from '#/lib/utils'
import { ButtonGroupText } from '#/components/ui/button-group'
import type { ComponentProps } from 'react'

/**
 * The attribute a fact carries. A `ButtonGroup` squares every inner corner and
 * drops every non-first member's left border, which is right between two
 * outlined buttons and wrong beside a fact that draws no box; a caller's group
 * class finds the facts by this attribute, not by position, because which
 * members are facts depends on the viewer and on the item
 * (`inbox-case-member.tsx`, `CASE_GROUP_CLASS`).
 */
export const FACT_ATTRIBUTE = 'data-fact'

/**
 * `ButtonGroupText` with the primitive's border, fill, shadow and weight
 * removed, at 13 px. `px-2.5` puts 10 px between a fact and its neighbour (20 px
 * between two facts); `first:pl-0` / `last:pr-0` keep a fact at either end of
 * the group on the group's own padding. The group stretches its members
 * (`items-stretch`), so a fact beside a 36 px control is 36 px tall and centres
 * its words: no height of its own.
 *
 * A fact prints its words at EVERY width. A control may drop to a glyph below
 * `md` because it is a bordered square with an accessible name; a fact has no
 * box to say "press me" and no hover to explain itself, so its words are all it
 * has.
 */
const FACT_CLASS =
  'min-w-0 gap-1.5 border-0 bg-transparent px-2.5 text-[13px] font-normal shadow-none first:pl-0 last:pr-0'

/** One member of a group with nothing to press. */
export function Fact({ className, ...props }: ComponentProps<typeof ButtonGroupText>) {
  return (
    <ButtonGroupText
      {...{ [FACT_ATTRIBUTE]: '' }}
      className={cn(FACT_CLASS, className)}
      {...props}
    />
  )
}
