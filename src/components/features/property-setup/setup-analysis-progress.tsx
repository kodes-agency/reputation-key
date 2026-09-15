import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { reviewAnalysisShare } from '#/components/features/property/settings/review-analysis-progress-card'
import { Badge } from '#/components/ui/badge'
import { aiKeys } from '#/shared/queries/query-keys'
import type { PropertySetupFns, SetupImportedProperty } from './property-setup-contract'

const numberFormat = new Intl.NumberFormat('en')
/** History is read a few reviews a minute (ADR 0058); poll gently while it moves. */
const ANALYSING_POLL_MS = 15_000

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
    refetchInterval: (query) =>
      query.state.data?.status === 'analysing' ? ANALYSING_POLL_MS : false,
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
        <Badge variant={counted?.status === 'caught_up' ? 'secondary' : 'outline'}>
          {progress.isError
            ? 'Unavailable'
            : !data
              ? 'Checking…'
              : data.status === 'disabled'
                ? 'Starting'
                : data.status === 'caught_up'
                  ? 'Up to date'
                  : 'Analysing'}
        </Badge>
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
          {numberFormat.format(counted.analysed)} analysed ·{' '}
          {numberFormat.format(counted.queued)} waiting ·{' '}
          {numberFormat.format(counted.inProgress)} running
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
