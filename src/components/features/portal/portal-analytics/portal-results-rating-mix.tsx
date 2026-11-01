import { SectionTitle } from '#/components/ui/section-title'
// "Stars given" (board 07): the five star counts of the period. The mix is held
// back with the average (below the floor it would give the average away), and
// the server says what the floor is.
import { RatingDistributionChart } from '#/components/features/shared/rating-distribution-chart'
import type { PortalAnalyticsData } from '#/contexts/reporting/application/public-api'
import { formatNumber } from '#/lib/format'

export function PortalResultsRatingMix({
  data,
  headingId,
}: Readonly<{ data: PortalAnalyticsData; headingId: string }>) {
  const { avgRating } = data.kpis
  const shown = data.ratingDistribution.length > 0
  return (
    <div className="space-y-3">
      <SectionTitle id={headingId}>Stars given</SectionTitle>
      {shown ? (
        <>
          <RatingDistributionChart
            distribution={data.ratingDistribution}
            labelledBy={headingId}
            label="Stars given"
          />
          <p className="text-sm text-muted-foreground">
            From {formatNumber(avgRating.sampleCount)} ratings.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {avgRating.evidence.state === 'insufficient_data'
            ? `The mix appears from ${data.thresholds.averageMinSample} ratings, so it cannot give one rating away.`
            : 'The mix appears once the ratings are counted.'}
        </p>
      )}
    </div>
  )
}
