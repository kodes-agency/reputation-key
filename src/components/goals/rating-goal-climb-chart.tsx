// "The climb, step by step" (round 5, PLAN-D E12, mock D3): Google's exact
// average over time, the plan as a cone from where it was set or last changed,
// the likely band from today, a dashed line where Google shows each tenth, and
// the days Google's own number moved. Recharts is a chunk of its own: the
// detail page loads this module lazily, so the chart never joins first paint
// and the page's words do not wait for it. Every point comes from the read in
// whole days from today and thousandths of a star; nothing is worked out here,
// and nothing moves (no animation).
import {
  Area,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartConfig } from '#/components/ui/chart'
import { ChartFrame } from '#/components/features/shared/chart-frame'
import { useIsMobile } from '#/components/hooks/use-mobile'
import type { RatingGoalBandPoint } from '#/contexts/reporting/application/dto/rating-goal.types'
import { dayTickLabel, type ClimbChartModel } from './rating-goal-climb-chart-view'

const config = {
  exact: { label: 'Google’s exact average', color: 'var(--foreground)' },
  plan: { label: 'Your plan', color: 'var(--primary)' },
  likely: { label: 'Likely', color: 'var(--link)' },
} satisfies ChartConfig

/** Small words on the chart, with a halo in the card's colour where a line runs behind them. */
const LABEL = {
  fontSize: 12,
  stroke: 'var(--card)',
  strokeWidth: 4,
  strokeLinejoin: 'round',
  paintOrder: 'stroke',
} as const

const range = (point: RatingGoalBandPoint): [number, number] => [point.low, point.high]

export function RatingGoalClimbChart({ model }: Readonly<{ model: ClimbChartModel }>) {
  const phone = useIsMobile()
  const { chart } = model
  return (
    <ChartFrame label="The climb, step by step" caption={model.caption} config={config}>
      {/*
        No accessibility layer: without a tooltip it is a Tab stop that does
        nothing. The figure's name and caption are the text alternative, and
        the rows below say the same facts.
      */}
      <ComposedChart
        accessibilityLayer={false}
        margin={{ left: 8, right: 8, top: 16, bottom: 0 }}
      >
        <XAxis
          type="number"
          dataKey="day"
          domain={[...model.xDomain]}
          ticks={[...(phone ? model.phoneTicks : model.ticks)]}
          tickFormatter={dayTickLabel}
          // Exactly the ticks the model spaced for the span; none dropped.
          interval={0}
          tickLine={false}
          axisLine={false}
          allowDataOverflow
        />
        <YAxis type="number" domain={[...model.yDomain]} hide allowDataOverflow />
        {model.lines.map((line) => (
          <ReferenceLine
            key={line.thousandths}
            y={line.thousandths}
            stroke={line.goal ? 'var(--color-plan)' : 'var(--border)'}
            strokeDasharray="4 4"
            label={{
              ...LABEL,
              value: phone ? line.shortLabel : line.label,
              position: 'insideTopLeft',
              fill: line.goal ? 'var(--link)' : 'var(--muted-foreground)',
            }}
          />
        ))}
        {chart.plan.length === 0 ? null : (
          <Area
            data={[...chart.plan]}
            dataKey={range}
            type="linear"
            stroke="var(--color-plan)"
            strokeDasharray="3 3"
            fill="var(--color-plan)"
            fillOpacity={0.12}
            isAnimationActive={false}
          />
        )}
        {chart.likely.length === 0 ? null : (
          <Area
            data={[...chart.likely]}
            dataKey={range}
            type="linear"
            stroke="none"
            fill="var(--color-likely)"
            fillOpacity={0.45}
            isAnimationActive={false}
          />
        )}
        {chart.history === null ? null : (
          <Line
            data={[...chart.history]}
            dataKey="thousandths"
            type="linear"
            stroke="var(--color-exact)"
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />
        )}
        <ReferenceLine
          x={chart.anchor.day}
          stroke="var(--border)"
          strokeDasharray="2 4"
          label={{
            ...LABEL,
            value: phone ? model.anchorShortLabel : model.anchorLabel,
            position: 'insideBottomLeft',
            fill: 'var(--muted-foreground)',
          }}
        />
        {model.dots.map((dot) => (
          <ReferenceDot
            key={`${dot.day}-${dot.thousandths}`}
            x={dot.day}
            y={dot.thousandths}
            r={5}
            fill={dot.up ? 'var(--positive)' : 'var(--warn)'}
            stroke="none"
            label={
              // On a phone the moves are in the list below, not on the lines.
              dot.label === null || phone
                ? undefined
                : {
                    ...LABEL,
                    value: dot.label,
                    position: 'bottom',
                    fill: dot.up ? 'var(--positive)' : 'var(--warn)',
                  }
            }
          />
        ))}
        {/*
          Above the goal's line, where nothing else is drawn: the band runs up
          to the line from below, so its words never cover it (and need no
          halo). On a phone they are in the caption.
        */}
        {phone || model.bandAt === null || model.bandLabel === null ? null : (
          <ReferenceDot
            x={model.bandAt.day}
            y={model.bandAt.thousandths}
            r={0}
            label={{
              value: model.bandLabel,
              position: 'top',
              fontSize: 12,
              fill: 'var(--link)',
              fontWeight: 600,
            }}
          />
        )}
        {chart.today === null ? (
          <ReferenceLine
            x={0}
            stroke="var(--foreground)"
            strokeDasharray="2 4"
            label={{ ...LABEL, value: model.todayLabel, position: 'insideTopRight' }}
          />
        ) : (
          <ReferenceDot
            x={0}
            y={chart.today}
            r={5.5}
            fill="var(--color-exact)"
            stroke="none"
            label={{
              ...LABEL,
              value: model.todayLabel,
              position: 'left',
              fill: 'var(--foreground)',
            }}
          />
        )}
      </ComposedChart>
    </ChartFrame>
  )
}
