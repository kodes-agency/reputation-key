// One tile of the Overview scorecard (redesign rows 4, 5, 8, 12).
//
// Differs from `StatCard` in three ways that are the point of the redesign:
//
// 1. It is a link. Every number on Overview is the door to the page that
//    explains it, so the tile itself is the affordance rather than carrying a
//    separate "view details".
// 2. It never prints an availability line when the metric is ready. The old
//    KPI strip printed `Ready · Data through Sep 11, 2026, 3:59 PM UTC` under
//    all four tiles; availability renders by exception now (row 8).
// 3. It never renders a dash. A metric with no number states its one sentence
//    and, where the manager can act, points at the action (row 12).
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { cn } from '#/lib/utils'

/**
 * Where the tile goes: usually the page that explains its number, but a tile
 * whose figure is missing for want of setup points at the setup instead — the
 * tile *is* the action.
 *
 * Nothing inside a tile may be a link. The tile is one, and nesting `<a>`
 * inside `<a>` is invalid HTML that React reports as a hydration error.
 */
type TileLink =
  | Readonly<{
      to:
        | '/properties/$propertyId'
        | '/properties/$propertyId/ratings'
        | '/properties/$propertyId/google'
        | '/properties/$propertyId/guests'
      params: Readonly<{ propertyId: string }>
    }>
  | Readonly<{
      to: '/settings/integrations' | '/settings/ai'
      search: Readonly<{ propertyId: string }>
    }>

type Props = Readonly<{
  label: string
  /** The number a manager recognises. Absent means there is no number yet. */
  value: string | null
  /** One line under the value: the pulse, or why there is no number. */
  context: ReactNode
  link: TileLink
  /** Reads the tile for assistive technology as a destination, not a heading. */
  linkLabel: string
  className?: string
}>

const TILE_CLASS =
  'group flex min-w-0 flex-col rounded-lg border p-4 transition-colors hover:border-border hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

export function OverviewTile({
  label,
  value,
  context,
  link,
  linkLabel,
  className,
}: Props) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <ArrowRight
          className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          aria-hidden="true"
        />
      </span>
      {value === null ? null : (
        <span className="mt-2 text-3xl font-semibold tabular-nums">{value}</span>
      )}
      <span
        className={cn('text-sm text-muted-foreground', value === null ? 'mt-2' : 'mt-1')}
      >
        {context}
      </span>
    </>
  )

  // Two branches rather than a spread: the router's types are per-route, and a
  // cast here would be the one place a wrong destination could pass unnoticed.
  if ('search' in link) {
    return (
      <Link
        to={link.to}
        search={link.search}
        aria-label={linkLabel}
        className={cn(TILE_CLASS, className)}
      >
        {body}
      </Link>
    )
  }

  return (
    <Link
      to={link.to}
      params={link.params}
      aria-label={linkLabel}
      className={cn(TILE_CLASS, className)}
    >
      {body}
    </Link>
  )
}

/**
 * Direction marker for a pulse line. Never alone: the caller always renders a
 * signed figure beside it, so the meaning survives without colour (row 10).
 */
export function PulseDelta({
  percent,
  suffix = 'vs the prior 30 days',
}: Readonly<{ percent: number | null; suffix?: string }>) {
  if (percent === null) return null
  if (percent === 0) return <>No change {suffix}</>
  const up = percent > 0
  return (
    <span className={up ? 'text-positive' : 'text-negative'}>
      {up ? '↑' : '↓'} {Math.abs(percent)}% {suffix}
    </span>
  )
}
