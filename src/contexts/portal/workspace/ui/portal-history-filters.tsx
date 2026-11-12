// The filter pill and the quiet note beside it. One answer is always chosen, so
// this is the project's segmented control (a radio group), not a row of toggles.

import { SegmentedControl } from '#/components/ui/segmented-control'
import { usePortalHistory } from './portal-history-context'
import { HISTORY_FILTERS, type HistoryFilterKey } from './portal-history-rows'

const isFilterKey = (value: string): value is HistoryFilterKey =>
  HISTORY_FILTERS.some((filter) => filter.key === value)

export function PortalHistoryFilters() {
  const { filter, changeFilter, timeZone } = usePortalHistory()
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <SegmentedControl
        aria-label="Show in history"
        value={filter}
        onValueChange={(value) => {
          if (isFilterKey(value)) changeFilter(value)
        }}
        options={HISTORY_FILTERS.map(({ key, label }) => ({ value: key, label }))}
        touch
      />
      <p className="text-xs text-muted-foreground">Newest first · {timeZone} time</p>
    </div>
  )
}
