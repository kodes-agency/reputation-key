// The parts of the Google rating goal's detail page below its summary: the three
// tiles, the stars since the goal was set, the change log and the page's foot
// (how fresh Google's numbers are, and who sees this page).
import type { RatingGoalDetailView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { RatingDistributionChart } from '#/components/features/shared/rating-distribution-chart'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { Metric, MetricStrip, MetricValue } from '#/components/ui/metric-strip'
import { formatShortDate } from '#/lib/format'
import { detailTiles, freshnessText, starMixSummary } from './rating-goal-detail-view'
import { changeText } from './rating-goal-view'

type Detail = Readonly<{ detail: RatingGoalDetailView }>

export function RatingGoalTiles({ detail }: Detail) {
  const tiles = detailTiles(detail)
  if (tiles.length === 0) return null
  return (
    // Three tiles, never two and one: stacked until there is room for all three.
    <MetricStrip
      aria-label="This goal in numbers"
      variant="tiles"
      columns={3}
      className="@max-2xl:grid-cols-1"
    >
      {tiles.map((tile) => (
        <Metric key={tile.label} label={tile.label}>
          <MetricValue value={tile.value} detail={tile.detail} />
        </Metric>
      ))}
    </MetricStrip>
  )
}

export function RatingGoalStarMix({ detail }: Detail) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle as="h2" id="rating-goal-star-mix">
          Stars since the goal was set
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm">{starMixSummary(detail.starsSinceSet)}</p>
        {detail.starsSinceSet.length === 0 ? null : (
          <RatingDistributionChart
            distribution={detail.starsSinceSet}
            labelledBy="rating-goal-star-mix"
            label="Stars of the new Google reviews"
            noun="reviews"
          />
        )}
      </CardContent>
    </Card>
  )
}

export function RatingGoalChangeLog({
  detail,
  personName,
  timezone,
  now,
}: Detail &
  Readonly<{
    /** The person's name once the members are read; null until then, or for a former member. */
    personName: (userId: string) => string | null
    timezone: string
    now: Date
  }>) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle as="h2">Changes</CardTitle>
      </CardHeader>
      <CardContent>
        {detail.changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No changes since the goal was set.
          </p>
        ) : (
          <ul className="flex flex-col divide-y text-sm">
            {detail.changes.map((change) => (
              <li
                key={`${change.changedAt}-${change.field}`}
                className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0"
              >
                <span className="font-medium">{changeText(change)}</span>
                <span className="text-muted-foreground">
                  {[
                    personName(change.changedBy) ?? 'A manager',
                    formatShortDate(change.changedAt, timezone, now),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/** How fresh Google's numbers are, and who sees this page. */
export function RatingGoalFoot({ detail, readAt }: Detail & Readonly<{ readAt: Date }>) {
  return (
    <p className="text-xs text-muted-foreground">
      {detail.google === null
        ? 'Google’s numbers are not in yet'
        : freshnessText(detail.google.asOf, readAt)}
      {' · '}Owners and managers only
    </p>
  )
}
