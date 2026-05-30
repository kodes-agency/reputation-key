// Time range picker — shared between dashboard and portal analytics.
import {
  TIME_RANGE_OPTIONS,
  type TimeRangePreset,
} from '#/contexts/dashboard/application/dto/dashboard.dto'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'

type Props = Readonly<{
  timeRange: TimeRangePreset
  onChange: (v: string) => void
}>

export function TimeRangePicker({ timeRange, onChange }: Props) {
  return (
    <div className="flex justify-end">
      <Tabs value={timeRange} onValueChange={onChange} className="min-w-0 shrink-0">
        <TabsList className="flex-wrap">
          {TIME_RANGE_OPTIONS.map((opt) => (
            <TabsTrigger key={opt.value} value={opt.value} className="text-xs">
              {opt.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}
