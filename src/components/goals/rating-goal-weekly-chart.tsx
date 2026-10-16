// New Google reviews each Monday-to-Sunday week since the goal was set, as bars
// against the chosen pace, a dashed line. Recharts is a chunk of its own: the
// detail page loads this module lazily, so the chart never joins first paint
// and the page's numbers do not wait for it.
import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts'
import {
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '#/components/ui/chart'
import { ChartFrame } from '#/components/features/shared/chart-frame'
import { formatLocalDate } from '#/lib/format'
import { weeklyCaption } from './rating-goal-detail-view'
import { perWeekText } from './rating-goal-pace-words'

const config = {
  count: { label: 'New reviews', color: 'var(--muted-foreground)' },
} satisfies ChartConfig

type Props = Readonly<{
  weeks: readonly Readonly<{ weekStart: string; count: number }>[]
  /** The plan's pace in tenths of a review a week, drawn a week as the dashed line; none to keep. */
  paceTenthsPerWeek: number | null
}>

/** "Oct 12": the Monday a week starts on, a stored day that no zone moves. */
const weekLabel = (weekStart: string): string =>
  formatLocalDate(weekStart, { year: false }) ?? weekStart

export function RatingGoalWeeklyChart({ weeks, paceTenthsPerWeek }: Props) {
  if (weeks.length === 0) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        The first week has only just started.
      </p>
    )
  }
  return (
    <ChartFrame
      label="New Google reviews each week"
      caption={weeklyCaption(weeks, paceTenthsPerWeek)}
      size="standard"
      config={config}
    >
      <BarChart
        accessibilityLayer
        data={[...weeks]}
        margin={{ left: 0, right: 8, top: 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="weekStart"
          interval="preserveStartEnd"
          minTickGap={32}
          tickLine={false}
          axisLine={false}
          tickFormatter={weekLabel}
        />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(label) =>
                typeof label === 'string' ? `Week of ${weekLabel(label)}` : label
              }
            />
          }
        />
        <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
        {paceTenthsPerWeek === null ? null : (
          <ReferenceLine
            y={paceTenthsPerWeek / 10}
            stroke="var(--foreground)"
            strokeDasharray="6 4"
            strokeWidth={2}
            ifOverflow="extendDomain"
            // A halo in the card's colour keeps the label legible where a bar
            // runs up behind it, as one does on a phone.
            label={{
              value: `Plan ${perWeekText(paceTenthsPerWeek)}`,
              position: 'insideTopRight',
              fill: 'var(--foreground)',
              fontSize: 12,
              stroke: 'var(--card)',
              strokeWidth: 4,
              strokeLinejoin: 'round',
              paintOrder: 'stroke',
            }}
          />
        )}
      </BarChart>
    </ChartFrame>
  )
}
