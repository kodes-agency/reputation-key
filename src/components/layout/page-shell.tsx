import type { ComponentProps, ReactNode } from 'react'
import { cn } from '#/lib/utils'

// The page gutter, owned in one place.
//
// `<main>` in the authenticated layout is the only element that pads a page: 16px
// on a phone and 24px from `md`, 20px / 32px above and below. A full-bleed surface
// (see `isFullBleedRoute`) is the one case where `<main>` pads nothing; its edge to
// edge bands and padded bodies wear these tokens, never a copy of the string.
//
// The values are complete class names, so Tailwind finds them here. They live with
// PageShell, already in the first-paint closure; a separate module shared with lazy
// chunks would become a chunk of its own.

/** All four sides: what `<main>` wears, and what `FullBleedFrame` gives back. */
export const PAGE_GUTTER = 'px-4 py-5 md:px-6 md:py-8'

/** Sides only: a full-bleed band (header, tab strip) that sets its own height. */
export const PAGE_GUTTER_X = 'px-4 md:px-6'

/**
 * A row that scrolls past the phone gutter to the screen edge and starts its
 * first item back on the gutter. Phone only: from `md` the gutter is 24px and
 * the row stays inside it. Valid only under a plain `<main>` gutter, which is
 * the one it undoes.
 */
export const PAGE_GUTTER_BLEED_PHONE = 'max-md:-mx-4 max-md:px-4'

export type PageTier = 'dashboard' | 'standard' | 'narrow'

const TIER_WIDTH: Readonly<Record<PageTier, string>> = {
  // 1200, not 1600: wider stretches tiles, tables and few-bar charts too far, and
  // keeps explanatory copy in a readable line length.
  dashboard: 'max-w-[1200px]',
  standard: 'max-w-5xl',
  narrow: 'max-w-3xl',
}

type Props = Readonly<{
  /** Content max-width tier. Defaults to `standard`. */
  tier?: PageTier
  children: ReactNode
  className?: string
}>

/**
 * Uniform page wrapper for authenticated pages; padding comes from `<main>`.
 * The tier selects the content max-width:
 *   - `dashboard` — wide, for data-dense surfaces (KPIs, trends, tables)
 *   - `standard`  — default, for lists & management
 *   - `narrow`    — for forms & settings
 */
export function PageShell({ tier = 'standard', children, className }: Props) {
  return (
    <div
      className={cn('mx-auto w-full space-y-5 md:space-y-8', TIER_WIDTH[tier], className)}
    >
      {children}
    </div>
  )
}

// A frame that owns its scroll takes focus, as the Inbox's panes do: with nothing
// focusable inside it, a keyboard cannot scroll it at all. The outline is inset
// because the surface around it clips a ring drawn outside.
const SCROLL_FRAME =
  'h-full overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'

type FullBleedFrameProps = Readonly<
  Omit<ComponentProps<'div'>, 'ref'> & {
    /** Own the vertical scroll: fill the parent's height and scroll inside it. */
    scroll?: boolean
    /** The element drawn; a labelled region is a `section`. */
    as?: 'div' | 'section'
  }
>

/**
 * The page gutter, for a padded body inside a full-bleed surface (which drops the
 * `<main>` gutter). A width limit goes in `className` or in a `PageShell` inside.
 */
export function FullBleedFrame({
  as: Tag = 'div',
  scroll = false,
  className,
  ...props
}: FullBleedFrameProps) {
  return (
    <Tag
      className={cn(PAGE_GUTTER, scroll && SCROLL_FRAME, className)}
      tabIndex={scroll ? 0 : undefined}
      {...props}
    />
  )
}
