import type { ReactNode } from 'react'
import { cn } from '#/lib/utils'

export type PageTier = 'dashboard' | 'standard' | 'narrow'

const TIER_WIDTH: Readonly<Record<PageTier, string>> = {
  dashboard: 'max-w-[1600px]',
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
