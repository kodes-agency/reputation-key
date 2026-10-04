// One tile of the Overview scorecard (redesign rows 4, 5, 8, 12).
//
// A `MetricStrip` tile that is a link, so it wears the strip's label and figure
// type (`METRIC_LABEL_CLASS`, `METRIC_TILE_FIGURE_CLASS`) and the one row-link
// hover surface, and differs from a strip cell in three ways that are the point of
// the redesign:
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
import { dashboardRangeComparisonLabel } from '#/shared/dashboard-range'
import {
  METRIC_LABEL_CLASS,
  METRIC_TILE_FIGURE_CLASS,
} from '#/components/ui/metric-strip'
import { ROW_LINK_SURFACE } from '#/components/ui/row-link'

/** The pulse is the last 30 days against the 30 before; every delta on a tile names that baseline. */
export const PULSE_COMPARISON_LABEL =
  dashboardRangeComparisonLabel('30d') ?? 'vs the previous 30 days'

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
        | '/properties/$propertyId/settings/ai'
      params: Readonly<{ propertyId: string }>
    }>
  | Readonly<{
      to: '/settings/integrations'
      search: Readonly<{ propertyId: string }>
    }>

type Props = Readonly<{
  label: string
  /** The number a manager recognises. Absent means there is no number yet. */
  value: ReactNode
  /** One line under the value: the pulse, or why there is no number. */
  context: ReactNode
  link: TileLink
  /** Reads the tile for assistive technology as a destination, not a heading. */
  linkLabel: string
  className?: string
}>

// The width of the lane a separator lives in, and the pull that hides it (below).
const SEPARATOR_LANE = 'pl-3'
const SEPARATOR_PULL = '-ml-3'

/**
 * A tile's caption and the detail after it ("in the last 30 days · Up 12% vs the
 * previous 30 days"). They share a line when they fit; when they do not, the
 * detail drops to its own line and the dot stays behind. A dot typed into the
 * text would be left dangling at the end of the line above, so each part carries
 * its dot in its own left lane and the row is pulled one lane out of the clip: a
 * part that starts a line has its lane, and so its dot, clipped away.
 *
 * Nothing in here may be tall enough to want the clip's edge: the detail is a
 * line of text or a `MetricDelta`.
 */
export function TileCaption({
  caption,
  detail,
}: Readonly<{ caption: ReactNode; detail: ReactNode }>) {
  return (
    <span data-slot="tile-caption" className="block overflow-hidden">
      <span className={cn('flex flex-wrap', SEPARATOR_PULL)}>
        <span className={SEPARATOR_LANE}>{caption}</span>{' '}
        <span className={cn('relative', SEPARATOR_LANE)}>
          <span aria-hidden="true" className="absolute top-0 left-1">
            ·
          </span>{' '}
          {detail}
        </span>
      </span>
    </span>
  )
}

const TILE_CLASS = cn(
  'group flex min-w-0 flex-col rounded-lg border p-4',
  ROW_LINK_SURFACE,
)

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
        <span className={METRIC_LABEL_CLASS}>{label}</span>
        <ArrowRight
          className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          aria-hidden="true"
        />
      </span>
      {value === null ? null : (
        <span className={cn('mt-1', METRIC_TILE_FIGURE_CLASS)}>{value}</span>
      )}
      <span
        className={cn(
          'text-xs text-muted-foreground',
          value === null ? 'mt-1' : 'mt-0.5',
        )}
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
