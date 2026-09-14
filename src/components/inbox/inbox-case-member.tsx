// The two looks a member of the case toolbar's `ButtonGroup` can wear (plan
// v2.1 row 2), in one place so the three members cannot drift apart.
//
// Why this module exists. PR 2's first cut drew every no-move member as
// `ButtonGroupText` with the primitive's own box — `rounded-md border bg-muted
// shadow-xs text-sm font-medium` (`ui/button-group.tsx:47`) — and every control
// as an outlined `Button`. At 390 px, where a control collapses to a 36 px
// glyph square, the review measured the two looks at a fill contrast of 1.05:1
// (light) and 1.09:1 (dark), both bordered, both shadowed, both 36 x 36: a
// member's `GH` fact and a manager's `GH` trigger were the same square. That is
// finding #1 of the plan ("facts and controls wear the same clothes") in grey
// instead of in pill form. Row 2 is explicit that a fact is plain 13 px text
// with a glyph and NO box, and row 3 that the open status is `ButtonGroupText`;
// both hold here: a fact IS `ButtonGroupText`, with the box taken off.
import { cn } from '#/lib/utils'
import { ButtonGroupText } from '#/components/ui/button-group'
import type { ComponentProps } from 'react'

/**
 * A control's geometry for the owner and escalation members: 32 px from `md`
 * up, a 36 px glyph square below it (row 20 — WCAG 2.5.8 AA asks for 24 px,
 * and 44 px on every strip control is what inflated v1's row). The status
 * control is deliberately NOT this shape: its word is the information, so it
 * keeps `[● Closed ▾]` at every width. `has-[>svg]:px-0` is needed because
 * `Button`'s `sm` size sets `has-[>svg]:px-2.5`, whose `:has()` out-specifies a
 * bare `max-md:px-0`.
 */
export const CASE_SQUARE_CLASS =
  'gap-1.5 max-md:size-9 max-md:px-0 max-md:has-[>svg]:px-0'

/**
 * Restores a control's own edge where it meets a fact. `ButtonGroup` squares
 * every inner corner and drops every non-first member's left border
 * (`ui/button-group.tsx:13`), which is right between two outlined buttons and
 * wrong beside a fact that no longer draws a box: `● Open [GH ▾]` would lose
 * the owner trigger's left border and both its left radii. Each selector is one
 * attribute more specific than the group's own (0,3,0 against 0,2,0), so the
 * result does not depend on the order Tailwind emits the two rules in.
 *
 * The facts are found by `data-case-fact`, not by position, because which
 * members are facts depends on the viewer's permissions and on the item: a
 * Member can see `● Open [👤 ▾] ⚑ Escalated`, a fact on both sides of one
 * control.
 */
export const CASE_GROUP_CLASS =
  '[&>[data-case-fact]+:not([data-case-fact])]:rounded-l-md [&>[data-case-fact]+:not([data-case-fact])]:border-l [&>:not([data-case-fact]):has(+[data-case-fact])]:rounded-r-md'

/**
 * The fact look: `ButtonGroupText` with the primitive's border, fill, shadow
 * and weight removed, at the 13 px the reply-due detail beside it already uses.
 * `px-2.5` puts 10 px between a fact and its neighbour (20 px between two
 * facts); `first:pl-0` / `last:pr-0` keep a fact at either end of the group on
 * the toolbar's own padding, so `● Open` starts on the same line as the thread
 * below it. The group stretches its members (`items-stretch`), so a fact beside
 * a 36 px control is 36 px tall and centres its words — no height of its own.
 *
 * A fact prints its words at EVERY width. Below `md` a control may drop to its
 * glyph, because it is a bordered square with an accessible name; a fact has no
 * box to say "press me" and no hover to explain itself, so its words are all it
 * has — and the contract requires every toned element to print them.
 */
const CASE_FACT_CLASS =
  'min-w-0 gap-1.5 border-0 bg-transparent px-2.5 text-[13px] font-normal shadow-none first:pl-0 last:pr-0'

/** One member of the group with nothing to press. */
export function CaseFact({
  className,
  ...props
}: ComponentProps<typeof ButtonGroupText>) {
  return (
    <ButtonGroupText
      data-case-fact=""
      className={cn(CASE_FACT_CLASS, className)}
      {...props}
    />
  )
}
