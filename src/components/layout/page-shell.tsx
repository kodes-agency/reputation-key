import type { ReactNode } from 'react'
import { cn } from '#/lib/utils'

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
