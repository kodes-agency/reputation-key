// The Results tab's one control row (board 07): the range, the days it covers in
// the Property's own time zone, and the switch that sets the period before
// beside it. All Time has no period before, so the switch is not drawn there.
import { useId } from 'react'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  timeRangePreset,
  type TimeRangePreset,
} from '#/contexts/reporting/application/dto/dashboard.dto'
import type { PortalAnalyticsData } from '#/contexts/reporting/application/public-api'
import {
  PORTAL_RESULTS_RANGES,
  compareLabel,
  windowCaption,
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
        <Select
          value={timeRange}
          onValueChange={(value) => {
            const parsed = timeRangePreset.safeParse(value)
            if (parsed.success) onTimeRangeChange(parsed.data)
          }}
        >
          <SelectTrigger aria-label="Time range" className="min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {PORTAL_RESULTS_RANGES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          {localDays === null
            ? `Every reading so far, ${timezone} time`
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
