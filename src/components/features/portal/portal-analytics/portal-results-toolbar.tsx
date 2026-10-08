// The Results tab's one control row (board 07): the range, the days it covers in
// the Property's own time zone, and the switch that sets the period before
// beside it. All Time has no period before, so the switch is not drawn there.
import { useId } from 'react'
import { Checkbox } from '#/components/ui/checkbox'
import { RangeControl } from '#/components/ui/range-control'
import type { TimeRangePreset } from '#/contexts/reporting/application/dto/dashboard.dto'
import type { PortalAnalyticsData } from '#/contexts/reporting/application/public-api'
import {
  PORTAL_RESULTS_RANGES,
  compareLabel,
  windowCaption,
  zoneTimeLabel,
} from './portal-results-window'

type Props = Readonly<{
  timeRange: TimeRangePreset
  onTimeRangeChange: (timeRange: TimeRangePreset) => void
  compare: boolean
  onCompareChange: (compare: boolean) => void
  /** The window in local days; null for All Time. */
  localDays: PortalAnalyticsData['localDays']
  timezone: string
}>

export function PortalResultsToolbar({
  timeRange,
  onTimeRangeChange,
  compare,
  onCompareChange,
  localDays,
  timezone,
}: Props) {
  const compareId = useId()
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
      {localDays === null ? null : (
        <div className="flex min-h-11 items-center gap-2">
          <Checkbox
            id={compareId}
            checked={compare}
            onCheckedChange={(checked) => onCompareChange(checked === true)}
          />
          <label htmlFor={compareId} className="text-sm">
            {compareLabel(localDays)}
          </label>
        </div>
      )}
    </div>
  )
}
