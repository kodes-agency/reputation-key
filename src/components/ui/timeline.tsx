import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '#/lib/utils'

// Vertical rail: a 32 px indicator column, a 2 px connector from each indicator
// to the next item, content 12 px to the right.
//
// No list semantics, deliberately: callers already give each entry its own
// `<article>` with an `aria-label`, and the rail may hold non-entry nodes (a
// fold toggle) that would make a list's item count wrong; a `<ul>` may hold
// only `<li>` (axe `list`). Props are spread, so a caller that wants a list
// passes `role="list"` / `role="listitem"` itself.
//
// Geometry is CSS only. The ITEM is `relative` and carries the bottom padding;
// the connector runs from the bottom of the indicator's 32 px slot (`top-8`) to
// the bottom of the item (`bottom-0`), so it always reaches the next item's top
// edge whatever the content height.
//
// The `sm` disc is inset 4 px inside its slot, so a slot-to-slot segment would
// stop 4 px short of every event disc. `TimelineItem` therefore moves the two
// ends by the inset: its own indicator (`top-7`) and the next item's
// (`-bottom-1`). Selectors name the indicator slot and `data-size` as a direct
// child only: a `Button size="sm"` in the content also carries `data-size="sm"`
// and must not move the rail.
//
// The last item draws no connector and no padding (`:last-child`), so a
// `Timeline`'s children are `TimelineItem`s only: render status lines after the
// `Timeline`, and never wrap an entry whose content renders `null`.
//
// The Storybook Vitest project compiles no Tailwind, so this geometry is not
// provable there.

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
 * One node of the rail. `pb-3` is the default rhythm between system events; a
 * message passes its own (`pb-4`), `cn` resolves the conflict, and `last:pb-0`
 * still applies because it is a different variant.
 *
 * `relative` is load-bearing: it is the connector's containing block. The
 * connector's `left-[15px]` assumes the indicator sits at the item's left edge,
 * so do not give the item horizontal padding.
 */
/**
 * Connector ends when a 24 px disc sits at either end: from this item's own
 * `sm` disc's bottom edge (`top-7`), and 4 px past the item (`-bottom-1`) when
 * the NEXT item's disc is the inset `sm` one.
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
 * `default` is a 32 px disc (people and messages). `sm` is a 24 px disc for
 * system events, inset `m-1` so it still occupies a 32 x 32 slot: the rail is
 * one vertical line at x = 16 px and an event's first line centres on the same
 * band as a message header. `TimelineItem`'s `RAIL_ENDS_CLASS` accounts for
 * the inset.
 *
 * `--border-strong` has no `--color-*` mapping in `styles.css`, hence the
 * `border-(--border-strong)` spelling. A glyph without its own `size-*` gets
 * 16 px on a 32 px disc and 14 px on a 24 px one.
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
 * Decorative, always: `aria-hidden` is set after the spread, so no caller can
 * put the rail into the accessibility tree. The entry must also say in words
 * what the disc shows; colour and glyph never carry meaning alone.
 *
 * Nothing focusable belongs in here: `aria-hidden-focus` is disabled globally
 * in `.storybook/preview.tsx` for Radix modals, so the gate would not catch it.
 * Put buttons in `TimelineContent`.
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
 * The 2 px segment from this item's disc edge to the next item's disc edge.
 * Decoration, not a boundary a user must perceive (WCAG 1.4.11 does not apply),
 * so it is aria-hidden. `left-[15px]` centres 2 px on the 32 px column's
 * midline (16 - 1); Tailwind has no 15 px step.
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

export { Timeline, TimelineConnector, TimelineContent, TimelineIndicator, TimelineItem }
