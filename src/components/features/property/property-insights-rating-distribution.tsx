import { RatingDistributionChart } from '#/components/features/shared/rating-distribution-chart'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import type { AiPropertyInsightsBasis } from '#/contexts/ai/application/public-api'

export function PropertyInsightsRatingDistribution({
  basis,
}: Readonly<{ basis: AiPropertyInsightsBasis }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 id="insights-rating-distribution-title">Rating distribution</h2>
        </CardTitle>
        <CardDescription>
          Every review in the basis is included here. Star-only reviews and reviews that
          predate aspect analysis do not contribute to aspect counts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mx-auto w-full max-w-3xl">
          <RatingDistributionChart
            distribution={basis.ratingDistribution}
            labelledBy="insights-rating-distribution-title"
          />
        </div>
      </CardContent>
    </Card>
  )
}
