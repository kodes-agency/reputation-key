// "Rating mix" (board 07): the five star counts of the period. The mix is held
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
      <h3 id={headingId} className="text-base font-semibold">
        Rating mix
      </h3>
      {shown ? (
        <>
          <RatingDistributionChart
            distribution={data.ratingDistribution}
            labelledBy={headingId}
            label="Rating mix"
          />
          <p className="text-sm text-muted-foreground">
            From {formatNumber(avgRating.sampleCount)} private ratings.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {avgRating.evidence.state === 'insufficient_data'
            ? `The mix appears from ${data.thresholds.averageMinSample} private ratings, so it cannot give one rating away.`
            : 'The mix appears once the ratings are counted.'}
        </p>
      )}
    </div>
  )
}
