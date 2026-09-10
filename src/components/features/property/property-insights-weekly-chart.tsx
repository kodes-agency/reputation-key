import { useId } from 'react'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '#/components/ui/chart'
import type {
  AiPropertyInsightAspectEvidenceState,
  AiPropertyInsightWeeklySeries,
} from '#/contexts/ai/application/public-api'
import { ASPECT_LABELS } from '#/shared/aspect-labels'

const SERIES_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const

export function PropertyInsightsWeeklyChart({
  series,
  aspectEvidenceState,
}: Readonly<{
  series: readonly AiPropertyInsightWeeklySeries[]
  aspectEvidenceState: AiPropertyInsightAspectEvidenceState
}>) {
  const titleId = useId()
  const descriptionId = useId()

  if (aspectEvidenceState === 'predates_aspect_analysis') {
    return (
      <p className="text-sm text-muted-foreground">
        These reviews were analysed before aspect analysis existed, so no weekly aspect
        trend can be plotted.
      </p>
    )
  }
  if (aspectEvidenceState === 'not_analyzed') {
    return (
      <p className="text-sm text-muted-foreground">
        There are no analysed text reviews in this period, so weekly aspect trends cannot
        be reported.
      </p>
    )
  }
  if (aspectEvidenceState === 'no_mentions' || series.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No weekly aspect trend can be plotted because no aspect mentions were identified
        in this period.
      </p>
    )
  }

  const visibleSeries = series.slice(0, SERIES_COLORS.length)

  const config: ChartConfig = Object.fromEntries(
    visibleSeries.map((entry, index) => [
      entry.aspect,
      {
        label: ASPECT_LABELS[entry.aspect],
        color: SERIES_COLORS[index % SERIES_COLORS.length],
      },
    ]),
  )
  const data = series[0].points.map((point, pointIndex) => {
    const row: Record<string, number | string> = {
      weekStartLocalDate: point.weekStartLocalDate,
    }
    for (const entry of visibleSeries) {
      row[entry.aspect] = entry.points[pointIndex]?.mentionCount ?? 0
    }
    return row
  })

  return (
    <figure aria-labelledby={titleId} aria-describedby={descriptionId}>
      <figcaption id={titleId} className="sr-only">
        Weekly mentions for the leading guest experience aspects
      </figcaption>
      <p id={descriptionId} className="sr-only">
        Each line shows weekly mention counts for one of the five aspects with the
        strongest weighted impact in the selected period.
      </p>
      <ChartContainer
        config={config}
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="aspect-auto h-[280px] w-full"
      >
        <LineChart
          accessibilityLayer
          data={data}
          margin={{ left: 0, right: 12, top: 8, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="weekStartLocalDate"
            tickLine={false}
            axisLine={false}
            minTickGap={16}
            tickFormatter={(value: string) => value.slice(5)}
          />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(value) => `Week of ${String(value)}`}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          {visibleSeries.map((entry) => (
            <Line
              key={entry.aspect}
              type="monotone"
              dataKey={entry.aspect}
              name={ASPECT_LABELS[entry.aspect]}
              stroke={`var(--color-${entry.aspect})`}
              strokeWidth={2}
              dot={data.length === 1}
              activeDot={{ r: 4 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
    </figure>
  )
}
