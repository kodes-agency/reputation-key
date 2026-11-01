// One range control, followed by the days it covers in the Property’s own zone.
import { RangeControl } from '#/components/ui/range-control'
import type { TimeRangePreset } from '#/contexts/reporting/application/dto/dashboard.dto'
import type { PortalAnalyticsData } from '#/contexts/reporting/application/public-api'
import {
  PORTAL_RESULTS_RANGES,
  windowCaption,
  zoneTimeLabel,
} from './portal-results-window'

type Props = Readonly<{
  timeRange: TimeRangePreset
  onTimeRangeChange: (timeRange: TimeRangePreset) => void
  /** The window in local days; null for All Time. */
  localDays: PortalAnalyticsData['localDays']
  timezone: string
}>

export function PortalResultsToolbar({
  timeRange,
  onTimeRangeChange,
  localDays,
  timezone,
}: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <RangeControl
          value={timeRange}
          onValueChange={onTimeRangeChange}
          options={PORTAL_RESULTS_RANGES}
        />
        <p className="text-sm text-muted-foreground">
          {localDays === null
            ? `Every reading so far, ${zoneTimeLabel(timezone)}`
            : windowCaption(localDays, timezone)}
        </p>
      </div>
    </div>
  )
}
