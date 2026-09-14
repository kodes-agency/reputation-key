import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '#/lib/utils'

// A vertical rail: a 32 px indicator column, a 2 px connector hanging from each
// indicator to the next item, and the content 12 px to the right (plan v2.1
// row 9). The inbox thread hangs the review, every system event, every note and
// the reply off one of these, so the pane reads as the record of a case.
//
// Why our own and not the registry's. `components.json` configures `@reui`, and
// ReUI's timeline value-imports `@base-ui/react` (`mergeProps`, `useRender`);
// this repo is on `radix-ui` and does not carry Base UI. DiceUI's is 22 KB with
// a `useSyncExternalStore` registry that tracks an active step — a stepper
// concern a read-only record does not have. So this file takes ReUI's SLOT
// NAMES and item shape and none of its code, context, or `step` state.
//
// No list semantics, deliberately. Every element here is a `div` with no role:
//
// - The caller already has structure. Each thread message is an `<article>`
//   with its own `aria-label` (`guest-message.tsx:304`, `note-message.tsx:33`,
//   `reply-message.tsx:84`); screen readers already step through those. A `<ul>`
//   around them adds "list, 7 items" and a position count to entries whose
//   order the timestamps already state. (An `<article>` IS legal inside an
//   `<li>` — the objection is the noise and the next point, not validity.)
// - The rail's nodes are not all entries of the record. Row 13's fold node
//   (`Show N earlier events`) stands in for four or more rows, so a list would
//   announce a count that is wrong in both directions. And a `<ul>` may hold
//   only `<li>` (axe `list`, an error in the Storybook gate,
//   `.storybook/preview.tsx`), so every non-item a caller placed in the rail
//   would become a gate failure rather than a layout choice.
// - The primitive has no domain knowledge, so it cannot know whether a future
//   caller's items ARE a list. Props are spread onto every element, so a caller
//   that wants one passes `role="list"` / `role="listitem"` itself.
//
// Geometry is CSS, not JavaScript. The connector's height is whatever the
// content is — a one-line event or a 200 px message — and nothing here measures
// it: the ITEM is `relative` and carries the bottom padding that spaces the
// rail, and the connector is absolutely positioned from the bottom of the
// indicator's 32 px slot (`top-8`) to the bottom of the item (`bottom-0`), which
// includes that padding. So the segment always reaches the next item's top
// edge, where the next 32 px indicator starts — and, for a 24 px one, 4 px
// further (next paragraph).
//
// The canvas (`LedgerNote.dc.html`, `.line`) draws the connector as a flex child
// with `margin: 4px 0` and `min-height: 12px`. Those 8 px of air are NOT copied:
// here the item's `pb-3` IS the whole segment between two one-line events, and
// 8 px of margin would leave a 4 px dash.
//
// Nor is any other air: the rail is ONE line, so every segment starts on its own
// disc's edge and ends on the next disc's edge, whatever the two weights. The
// 32 px slot alone does not give that. The `sm` disc is inset 4 px inside it
// (below), so a slot-to-slot segment stopped 4 px short of every event disc and
// started 4 px under it — measured in Chromium against `pnpm storybook`, a 4 px
// break above AND below each of the three events in `Inbox/Thread/Full Rail`, at
// 1440, 390 and 320 alike, which reads as a dashed rail rather than a record.
// So `TimelineItem` moves the two ends by the inset, in CSS, from the weights it
// can see: its OWN indicator (`top-7`, the 24 px disc's bottom edge at 28 px) and
// the NEXT item's (`-bottom-1`, 4 px into that item, where its disc's top edge
// is). Both selectors name the indicator slot and `data-size` together and only
// as a direct child: a `Button size="sm"` inside the content also carries
// `data-size="sm"` (row 13's fold toggle does), and must not move the rail. The
// segment never overlaps a disc, so no indicator tone has to be opaque and no
// z-index is involved.
//
// The last item draws no connector and no padding — `group-last/timeline-item:
// hidden` and `last:pb-0`, the same `:last-child` rule ReUI's separator uses.
// That makes one demand of the caller: a `Timeline`'s children are
// `TimelineItem`s only. A status line rendered INSIDE the rail after the last
// entry makes that entry not `:last-child`, and its connector then points at
// something that is not a node; render such lines after the `Timeline`. Equally,
// never wrap an entry whose content renders `null` (a draft `ReplyMessage`) — the
// empty item would still draw an indicator.
//
// The Storybook Vitest project compiles no Tailwind, so none of this geometry is
// provable there; `timeline.stories.tsx` proves structure, and the numbers were
// taken in Chromium against `pnpm storybook`.

function Timeline({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="timeline"
      className={cn('flex min-w-0 flex-col', className)}
      {...props}
    />
  )
}

/**
 * One node of the rail. `pb-3` (12 px) is the default rhythm between system
 * events — row 13 sizes an event row at 44 px, a 32 px slot plus this padding.
 * A message passes its own (`pb-4`); `cn` resolves the conflict in the caller's
 * favour, and `last:pb-0` still applies because it is a different variant.
 *
 * `relative` is load-bearing: it is the connector's containing block. The
 * connector's `left-[15px]` assumes the indicator sits at the item's left edge,
 * so do not give the item horizontal padding — pad the `Timeline`'s parent.
 */
/**
 * Where this item's connector starts and ends when a 24 px disc sits at either
 * end (see the file comment): from this item's own `sm` disc's bottom edge
 * (28 px, `top-7`) rather than the slot's, and 4 px past the item (`-bottom-1`)
 * when the NEXT item's disc is the inset `sm` one. A 32 px disc at either end
 * keeps the connector's own `top-8` / `bottom-0`.
 *
 * `:has()` with a direct-child and a next-sibling combinator: Chromium 105,
 * Safari 15.4, Firefox 121. The selectors outrank the connector's single-class
 * `top-8` / `bottom-0` by specificity, not by stylesheet order.
 */
const RAIL_ENDS_CLASS = [
  '[&:has(>[data-slot=timeline-indicator][data-size=sm])>[data-slot=timeline-connector]]:top-7',
  '[&:has(+[data-slot=timeline-item]>[data-slot=timeline-indicator][data-size=sm])>[data-slot=timeline-connector]]:-bottom-1',
]

function TimelineItem({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="timeline-item"
      className={cn(
        'group/timeline-item relative flex min-w-0 gap-3 pb-3 last:pb-0',
        RAIL_ENDS_CLASS,
        className,
      )}
      {...props}
    />
  )
}

/**
 * Two weights on one straight rail.
 *
 * `default` is a 32 px disc — people and messages (the guest, a note's author,
 * the reply). `sm` is a 24 px disc for system events, inset `m-1` so it still
 * occupies a 32 × 32 slot: centred horizontally, the rail through both weights
 * is one vertical line at x = 16 px; centred vertically, an event's first line
 * centres on the same 32 px band as a message header. A bare `size-6` would
 * pull the content 8 px left for every event and kink the column. The inset is
 * the one thing the connector must know about: `TimelineItem`'s
 * `RAIL_ENDS_CLASS` moves its ends 4 px so the line meets this disc's edge
 * rather than the slot's.
 *
 * The neutral look (surface fill, `--border-strong` ring, muted glyph, 11 px
 * semibold initials) is the canvas's `.ind`; a caller tones it with
 * `className`. `--border-strong` has no `--color-*` mapping in `styles.css`,
 * hence the `border-(--border-strong)` spelling `inbox-case-toolbar.tsx:75`
 * already uses. A glyph without its own `size-*` gets 16 px on a 32 px disc and
 * 14 px on a 24 px one.
 */
const timelineIndicatorVariants = cva(
  'flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-(--border-strong) bg-surface text-[11px] font-semibold text-muted-foreground [&_svg]:pointer-events-none',
  {
    variants: {
      size: {
        default: 'size-8 [&_svg:not([class*="size-"])]:size-4',
        sm: 'm-1 size-6 [&_svg:not([class*="size-"])]:size-3.5',
      },
    },
    defaultVariants: { size: 'default' },
  },
)

/**
 * Decorative, always: `aria-hidden` is set after the spread and removed from
 * the accepted props, so no caller can put the rail into the accessibility
 * tree. Whatever the disc shows — an avatar, initials, an icon — the entry must
 * also say in words (the author's name in the note header, the event's
 * sentence); colour and glyph never carry meaning alone.
 *
 * It follows that nothing focusable belongs in here. `aria-hidden-focus` is
 * disabled globally in `.storybook/preview.tsx` for Radix modals, so the gate
 * would NOT catch a button hidden from a screen reader; row 13's `Show N
 * earlier events` button goes in `TimelineContent`, beside a plain indicator.
 */
function TimelineIndicator({
  className,
  size = 'default',
  ...props
}: Omit<React.ComponentProps<'div'>, 'aria-hidden'> &
  VariantProps<typeof timelineIndicatorVariants>) {
  return (
    <div
      data-slot="timeline-indicator"
      data-size={size}
      className={cn(timelineIndicatorVariants({ size }), className)}
      {...props}
      aria-hidden="true"
    />
  )
}

/**
 * The 2 px segment from this item's disc edge to the next item's disc edge
 * (`top-8` / `bottom-0` for 32 px discs; `TimelineItem` moves either end by the
 * 24 px disc's 4 px inset). `bg-border`
 * because row 9 names the `border` token; it is decoration, not a boundary a
 * user must perceive (WCAG 1.4.11 applies to neither), and it is aria-hidden
 * for the same reason as the indicator. `left-[15px]` centres 2 px on the
 * 32 px column's midline (16 − 1); Tailwind has no 15 px step.
 */
function TimelineConnector({
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'aria-hidden'>) {
  return (
    <div
      data-slot="timeline-connector"
      className={cn(
        'absolute top-8 bottom-0 left-[15px] w-0.5 bg-border group-last/timeline-item:hidden',
        className,
      )}
      {...props}
      aria-hidden="true"
    />
  )
}

/**
 * The entry itself. `min-w-0` lets long prose and truncating headers shrink
 * inside the flex row instead of pushing the pane wider than the phone sheet.
 */
function TimelineContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="timeline-content"
      className={cn('min-w-0 flex-1', className)}
      {...props}
    />
  )
}

export {
  Timeline,
  TimelineConnector,
  TimelineContent,
  TimelineIndicator,
  TimelineItem,
  timelineIndicatorVariants,
}
