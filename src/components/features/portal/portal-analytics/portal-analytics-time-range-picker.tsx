// Time-range picker for portal analytics — extracted for line-count compliance.
// Toggle-button group (role="group" + aria-pressed) rather than Tabs: Tabs
// require a TabsContent panel or the trigger's aria-controls dangles, which
// fails axe's aria-valid-attr-value. Mirrors property-dashboard's pattern.
import { cn } from '#/lib/utils'
import {
  TIME_RANGE_OPTIONS,
  type TimeRangePreset,
} from '#/contexts/dashboard/application/dto/dashboard.dto'

export function TimeRangePicker({
  timeRange,
  onChange,
}: {
  timeRange: TimeRangePreset
  onChange: (v: string) => void
}) {
  return (
    <div className="flex justify-end">
      <div
        role="group"
        aria-label="Time range"
        className="inline-flex h-9 min-w-0 shrink-0 flex-wrap items-center justify-center gap-1 rounded-lg bg-muted p-[3px] text-muted-foreground"
      >
        {TIME_RANGE_OPTIONS.map((opt) => {
          const isActive = opt.value === timeRange
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(opt.value)}
              className={cn(
                'inline-flex h-[calc(100%-1px)] items-center justify-center rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap transition-all hover:text-foreground',
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-foreground/60',
              )}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
