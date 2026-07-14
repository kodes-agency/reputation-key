import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '#/components/ui/chart'
import { cn } from '#/lib/utils'

export type TrajectoryPoint = Readonly<{
  /** ISO date or label */
  t: string
  actual: number
  expected: number
}>

type GoalTrajectoryGraphProps = Readonly<{
  data: readonly TrajectoryPoint[]
  targetValue: number
  className?: string
  /** Use area (filled) or lines only */
  variant?: 'area' | 'line'
}>

const trajectoryConfig = {
  actual: { label: 'Actual', color: 'var(--chart-1)' },
  expected: { label: 'Expected (time passed)', color: 'var(--chart-2)' },
} satisfies ChartConfig

/**
 * GoalTrajectoryGraph — reusable time-series for actual vs expected progress (expected = proportional to time elapsed).
 * Follows documented chart patterns (Area/Line for time series).
 * Consumers are responsible for building the series from events/snapshots.
 */
export function GoalTrajectoryGraph({
  data,
  targetValue,
  className,
  variant = 'area',
}: GoalTrajectoryGraphProps) {
  if (!data.length) {
    return (
      <div
        className={cn(
          'flex h-48 items-center justify-center rounded border bg-muted/20 text-xs text-muted-foreground',
          className,
        )}
      >
        Insufficient history for trajectory
      </div>
    )
  }

  const Chart = variant === 'area' ? AreaChart : LineChart
  const maxY = Math.max(targetValue, ...data.map((d) => Math.max(d.actual, d.expected)))

  return (
    <ChartContainer
      config={trajectoryConfig}
      className={cn('min-h-[220px] w-full', className)}
    >
      <Chart data={[...data]} margin={{ left: 8, right: 8, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="t"
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => {
            const d = new Date(v)
            return isNaN(d.getTime()) ? v : `${d.getMonth() + 1}/${d.getDate()}`
          }}
        />
        <YAxis domain={[0, Math.ceil(maxY * 1.1)]} tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />

        {variant === 'area' ? (
          <>
            <Area
              type="monotone"
              dataKey="expected"
              stroke="var(--color-expected)"
              fill="var(--color-expected)"
              fillOpacity={0.12}
              strokeWidth={2}
              strokeDasharray="4 2"
            />
            <Area
              type="monotone"
              dataKey="actual"
              stroke="var(--color-actual)"
              fill="var(--color-actual)"
              fillOpacity={0.18}
              strokeWidth={2}
            />
          </>
        ) : (
          <>
            <Line
              type="monotone"
              dataKey="expected"
              stroke="var(--color-expected)"
              strokeDasharray="4 2"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="actual"
              stroke="var(--color-actual)"
              strokeWidth={2}
              dot={false}
            />
          </>
        )}
      </Chart>
    </ChartContainer>
  )
}
