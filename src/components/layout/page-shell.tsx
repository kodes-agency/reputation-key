import type { ComponentProps, ReactNode } from 'react'
import { cn } from '#/lib/utils'

// The page gutter, owned in one place.
//
// `<main>` in the authenticated layout is the only element that pads a page: 16px
// on a phone and 24px from `md`, 20px / 32px above and below. A page, a Property
// page or any route below it adds no padding of its own. A full-bleed surface
// (see `isFullBleedRoute`) is the one case where `<main>` pads nothing, so that
// surface owns its scroll; the bands it draws edge to edge (a header, a tab
// strip) and the bodies it pads wear these tokens, never a copy of the string.
//
// The values are complete class names, so Tailwind finds them here. They live
// with PageShell rather than in a module of their own: PageShell is already in
// the first-paint closure through the route fallbacks, and a separate module
// shared with lazy chunks becomes a chunk of its own.

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
  // 1200, not 1600: four scorecard tiles and a ten-row topic table stretched
  // across a 27" monitor read as a spreadsheet, and a 1088 px-wide chart of
  // five bars invited the 612 px height the survey found. Line length for the
  // explanatory copy on these pages lands in range at 1200 too.
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
 * Uniform page wrapper for authenticated pages. Padding (px-4/py-5 mobile,
 * px-6/py-8 desktop) comes from `<main>` in the authenticated layout.
 *
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

type FullBleedFrameProps = Readonly<
  Omit<ComponentProps<'div'>, 'ref'> & {
    /** Own the vertical scroll: fill the parent's height and scroll inside it. */
    scroll?: boolean
    /** The element drawn; a labelled region is a `section`. */
    as?: 'div' | 'section'
  }
>

/**
 * The page gutter, for a padded body inside a full-bleed surface.
 *
 * A full-bleed route (`isFullBleedRoute`) drops the `<main>` gutter so the
 * surface can own its height and scroll its own panes. A body in that surface
 * that reads like an ordinary page (loading and error fallbacks, a tab whose
 * content is a column of cards) wraps itself in this frame, which wears the
 * same gutter `<main>` does. A width limit goes in `className` next to it, or
 * inside it in a `PageShell`.
 */
export function FullBleedFrame({
  as: Tag = 'div',
  scroll = false,
  className,
  ...props
}: FullBleedFrameProps) {
  return (
    <Tag
      className={cn(PAGE_GUTTER, scroll && 'h-full overflow-y-auto', className)}
      {...props}
    />
  )
}
