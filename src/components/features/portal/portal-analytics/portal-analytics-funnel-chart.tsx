// Portal engagement funnel — geometry is monotonic by construction.
//
// Recharts maps each row's `dataKey` value straight onto trapezoid width, so a
// stage larger than the stage above it draws an inverted cone that reads as a
// rendering bug rather than as data. That shape is not hypothetical: with the
// portal.scan / portal.rating emission gaps the live payload is
// `{ scans: 0, ratings: 0, reviewLinkClicks: N }`, and it stays reachable once
// the producers are fixed because a scan can fail to record independently of a
// rating that follows it. So widths are clamped to the stage above while the
// readout keeps the true counts — geometry never lies about ordering, labels
// never lie about totals.
import { Cell, Funnel, FunnelChart } from 'recharts'
import { ChartContainer, type ChartConfig } from '#/components/ui/chart'

const funnelConfig = {
  scans: { label: 'Scans', color: 'var(--chart-1)' },
  ratings: { label: 'Private ratings', color: 'var(--chart-2)' },
  reviewLinkClicks: { label: 'Review Clicks', color: 'var(--chart-3)' },
} satisfies ChartConfig

/** A funnel step before clamping: the name, the recorded count, and the unit
 * noun the readout appends so a bare number never stands alone. */
type Stage = Readonly<{
  key: keyof typeof funnelConfig
  name: string
  actual: number
  singular: string
  plural: string
}>

export function EngagementFunnelChart({
  funnel,
  labelledBy,
}: {
  funnel: { scans: number; ratings: number; reviewLinkClicks: number }
  labelledBy: string
}) {
  const stages: readonly Stage[] = [
    {
      key: 'scans',
      name: 'Scans',
      actual: funnel.scans,
      singular: 'scan',
      plural: 'scans',
    },
    {
      key: 'ratings',
      name: 'Private ratings',
      actual: funnel.ratings,
      singular: 'rating',
      plural: 'ratings',
    },
    {
      key: 'reviewLinkClicks',
      name: 'Review Clicks',
      actual: funnel.reviewLinkClicks,
      singular: 'review click',
      plural: 'review clicks',
    },
  ]

  // Scans are the entry step, so a zero there clamps every width to zero: the
  // chart would be a blank strip. Say so instead of drawing nothing.
  if (funnel.scans === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No funnel data yet — scans are the first step and none were recorded in this
        period.
      </p>
    )
  }

  let ceiling = Number.POSITIVE_INFINITY
  const rows = stages.map((stage) => {
    const value = Math.min(stage.actual, ceiling)
    ceiling = value
    return {
      ...stage,
      value,
      clamped: value < stage.actual,
      fill: `var(--color-${stage.key})`,
    }
  })

  const anyClamped = rows.some((row) => row.clamped)

  return (
    <div className="space-y-3">
      <ChartContainer
        config={funnelConfig}
        // The trapezoids deliberately carry no in-shape text: a clamped stage
        // would print a count that disagrees with its own width, and a recharts
        // tooltip would report the clamped geometry value. The shape is one
        // named graphic; the counts live in the DOM readout below, where screen
        // readers and copy-paste both reach them.
        role="img"
        aria-labelledby={labelledBy}
        className="min-h-[200px] w-full"
      >
        <FunnelChart>
          <Funnel dataKey="value" data={rows} isAnimationActive>
            {rows.map((row) => (
              <Cell key={row.key} fill={row.fill} />
            ))}
          </Funnel>
        </FunnelChart>
      </ChartContainer>
      <ol className="space-y-1 text-xs">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: row.fill }}
            />
            <span className="text-muted-foreground">{row.name}</span>
            <span className="ml-auto font-medium tabular-nums">
              {row.actual.toLocaleString()} {row.actual === 1 ? row.singular : row.plural}
            </span>
          </li>
        ))}
      </ol>
      {anyClamped && (
        <p className="text-xs text-muted-foreground">
          Bar widths are capped to the step above — a later step can out-count an earlier
          one when a step fails to record.
        </p>
      )}
    </div>
  )
}
