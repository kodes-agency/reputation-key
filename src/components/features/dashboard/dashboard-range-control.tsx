// The dashboard's one range control (redesign row 6).
//
// Replaces three: `TimeRangePicker` (7/30/60/90/All, raw buttons, page
// overview), the insights control (30/90/180/All), and the Google block's own
// (7/30/90/180) — which rendered a second picker on the same page as the first
// and had to explain itself in prose: "This range is independent from the
// Dashboard range above."
//
// Two renderings of the same options, as the insights control already did well:
// a Select where a five-button row would wrap on a phone, a pressed-button
// group where it fits. Both are ≥ 44 px tall (row 13).
import { Button } from '#/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  DASHBOARD_RANGE_LABELS,
  DASHBOARD_RANGE_OPTIONS,
  DASHBOARD_RANGES,
  type DashboardRange,
} from '#/shared/dashboard-range'

const CONTROL_LABEL = 'Time range'

function isDashboardRange(value: string): value is DashboardRange {
  return (DASHBOARD_RANGES as ReadonlyArray<string>).includes(value)
}

export function DashboardRangeControl({
  range,
  onRangeChange,
}: Readonly<{
  range: DashboardRange
  onRangeChange: (range: DashboardRange) => void
}>) {
  return (
    <>
      <div className="sm:hidden">
        <Select
          value={range}
          onValueChange={(value) => {
            if (isDashboardRange(value)) onRangeChange(value)
          }}
        >
          <SelectTrigger aria-label={CONTROL_LABEL} className="min-h-11 min-w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {DASHBOARD_RANGE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div
        role="group"
        aria-label={CONTROL_LABEL}
        className="hidden items-center gap-1 sm:flex"
      >
        {DASHBOARD_RANGE_OPTIONS.map((option) => (
          <Button
            key={option.value}
            type="button"
            className="h-11 min-w-20"
            variant={range === option.value ? 'secondary' : 'ghost'}
            aria-pressed={range === option.value}
            onClick={() => onRangeChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </>
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
