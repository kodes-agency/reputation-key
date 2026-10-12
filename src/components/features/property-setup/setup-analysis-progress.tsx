import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  REVIEW_ANALYSIS_STATUS,
  reviewAnalysisShare,
} from '#/components/features/property/settings/review-analysis-progress-card'
import { StatusBadge, type StatusPresentation } from '#/components/ui/status-badge'
import { aiKeys } from '#/shared/queries/query-keys'
import { reviewAnalysisProgressRefetchInterval } from '#/shared/queries/review-analysis-progress-polling'
import type { ReviewAnalysisProgress } from '#/contexts/ai/application/public-api'
import type { PropertySetupFns, SetupImportedProperty } from './property-setup-contract'
import { formatNumber } from '#/lib/format'

function analysisPill(
  isError: boolean,
  data: ReviewAnalysisProgress | undefined,
): StatusPresentation {
  if (isError) return { label: 'Unavailable', tone: 'warn' }
  if (!data) return { label: 'Checking…', tone: 'neutral' }
  if (data.status === 'disabled') return { label: 'Starting', tone: 'neutral' }
  return REVIEW_ANALYSIS_STATUS[data.status]
}

function AnalysisRow({
  property,
  getReviewAnalysisProgress,
}: Readonly<{
  property: SetupImportedProperty
  getReviewAnalysisProgress: PropertySetupFns['getReviewAnalysisProgress']
}>) {
  const progress = useQuery({
    queryKey: aiKeys.reviewAnalysisProgress(property.propertyId),
    queryFn: () =>
      getReviewAnalysisProgress({ data: { propertyId: property.propertyId } }),
    staleTime: 10_000,
    refetchInterval: reviewAnalysisProgressRefetchInterval,
  })
  const data = progress.data
  const counted = data && data.status !== 'disabled' ? data : null
  const share = counted ? reviewAnalysisShare(counted) : 0

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to="/properties/$propertyId/settings/ai"
          params={{ propertyId: property.propertyId }}
          className="text-sm font-medium underline-offset-4 hover:underline"
        >
          {property.propertyName}
        </Link>
        <StatusBadge {...analysisPill(progress.isError, data)} />
      </div>
      <div
        role="progressbar"
        aria-label={`Reviews analysed at ${property.propertyName}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={counted ? Math.round(share * 100) : undefined}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full w-full origin-left rounded-full bg-primary transition-transform duration-500 ease-out motion-reduce:transition-none"
          style={{ transform: `scaleX(${share})` }}
        />
      </div>
      {counted ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatNumber(counted.analysed)} analysed · {formatNumber(counted.queued)}{' '}
          waiting · {formatNumber(counted.inProgress)} running
        </p>
      ) : null}
    </li>
  )
}

/**
 * Decision 15: an import's review history is analysed at a paced background
 * rate, newest first. Once AI is on, show how far each property has got.
 */
export function SetupAnalysisProgress({
  properties,
  getReviewAnalysisProgress,
}: Readonly<{
  properties: readonly SetupImportedProperty[]
  getReviewAnalysisProgress: PropertySetupFns['getReviewAnalysisProgress']
}>) {
  if (properties.length === 0) return null
  return (
    <section aria-labelledby="setup-analysis-title" className="flex flex-col gap-3">
      <div>
        <h3 id="setup-analysis-title" className="font-semibold">
          Review analysis
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Existing reviews are read newest first, a few a minute. Insights fill in as each
          analysis lands.
        </p>
      </div>
      <ul className="flex flex-col divide-y rounded-md border">
        {properties.map((property) => (
          <AnalysisRow
            key={property.propertyId}
            property={property}
            getReviewAnalysisProgress={getReviewAnalysisProgress}
          />
        ))}
      </ul>
    </section>
  )
}
