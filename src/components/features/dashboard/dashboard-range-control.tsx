// The dashboard's one range control (redesign row 6).
//
// Replaces three: `TimeRangePicker` (7/30/60/90/All, raw buttons, page
// overview), the insights control (30/90/180/All), and the Google block's own
// (7/30/90/180) — which rendered a second picker on the same page as the first
// and had to explain itself in prose: "This range is independent from the
// Dashboard range above."
//
// The control itself is `RangeControl` (a segmented control, a Select below
// `sm`, a tap target below `md`); this file gives it the dashboard's presets.
// The range lives in the page's `?range=` (`dashboardRangeSearch`), which is
// where a dashboard topic page keeps its state.
import { RangeControl } from '#/components/ui/range-control'
import {
  DASHBOARD_RANGE_LABELS,
  DASHBOARD_RANGE_OPTIONS,
  DASHBOARD_RANGES,
  type DashboardRange,
} from '#/shared/dashboard-range'

export function DashboardRangeControl({
  range,
  onRangeChange,
}: Readonly<{
  range: DashboardRange
  onRangeChange: (range: DashboardRange) => void
}>) {
  return (
    <RangeControl
      value={range}
      onValueChange={onRangeChange}
      options={DASHBOARD_RANGE_OPTIONS}
    />
  )
}

/**
 * One line, where the chosen range reaches back further than a source can
 * (row 6). This is what replaces a second picker: the page keeps one window
 * and says where this source's memory stops. Within the limit there is nothing
 * to explain, so nothing is said.
 */
export function RangeLimitNote({
  range,
  limit,
  source,
}: Readonly<{
  range: DashboardRange
  /** The furthest range this source can honour. */
  limit: DashboardRange
  /** Named in the sentence: "Google provides up to 6 months." */
  source: string
}>) {
  // DASHBOARD_RANGES is ordered shortest to longest, so position is reach.
  const reach = DASHBOARD_RANGES.indexOf(range)
  const limitReach = DASHBOARD_RANGES.indexOf(limit)
  if (reach <= limitReach) return null
  return (
    <p className="text-sm text-muted-foreground">
      {source} provides up to {DASHBOARD_RANGE_LABELS[limit].toLowerCase()}.
    </p>
  )
}
