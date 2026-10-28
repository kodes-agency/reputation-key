import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { DashboardRangeControl } from '#/components/features/dashboard/dashboard-range-control'
import { RangeBusyRegion } from '#/components/features/dashboard/range-busy-region'
import { GlossaryTerm } from '#/components/features/shared/glossary-term'
import { PageHeader } from '#/components/layout/page-header'
import { NAV_LABEL } from '#/components/layout/nav-labels'
import { trailCrumbs } from '#/components/layout/page-identity'
import { PageShell } from '#/components/layout/page-shell'
import { Skeleton } from '#/components/ui/skeleton'
import { ROW_FIGURE_LINK } from '#/components/ui/row-link'
import { cn } from '#/lib/utils'
import type {
  AiPropertyInsightsRead,
  AiTrendReportView,
  AiTrendSupportingReviewView,
} from '#/contexts/ai/application/public-api'
import type { getPropertyAiTrendFn } from '#/contexts/ai/server/property-trend'
import type { DashboardRange } from '#/shared/dashboard-range'
import { aiKeys } from '#/shared/queries/query-keys'
import { GuestVoiceState } from './property-guest-voice-state'
import { PropertyInsightsTopicTable } from './property-insights-aspect-table'
import { PropertyInsightsEmergingIssues } from './property-insights-emerging-issues'
import { formatNumber, formatLocalDate } from '#/lib/format'

type ReadyInsights = Extract<AiPropertyInsightsRead, { status: 'ready' }>

export type PropertyGuestVoiceServerFns = Readonly<{
  getTrend: typeof getPropertyAiTrendFn
}>

function pluralized(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`
}

export function PropertyGuestVoiceBasis({ result }: Readonly<{ result: ReadyInsights }>) {
  const { basis } = result
  return (
    <div className="flex flex-col gap-2 text-sm text-muted-foreground">
      <p>
        Based on {pluralized(basis.reviewCount, 'review')} ·{' '}
        {formatNumber(basis.analyzedReviewCount)} analysed
      </p>
      {result.provisional ? (
        <p>
          {basis.awaitingAnalysisCount > 0
            ? `${pluralized(basis.awaitingAnalysisCount, 'review')} still being analysed.`
            : 'Analysis is still filling in.'}{' '}
          Change is hidden until analysis is complete.
        </p>
      ) : null}
      {result.range === 'all' &&
      result.windowStartBasis === 'derivative_retention_horizon' ? (
        <p>AI analysis covers the most recent 24 months.</p>
      ) : null}
      <details className="w-fit max-w-full">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium text-foreground focus-ring">
          What is in this figure
        </summary>
        <dl className="grid gap-x-8 gap-y-2 pb-1 sm:grid-cols-2">
          <div className="flex justify-between gap-6">
            <dt>Reviews without text</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {formatNumber(basis.starOnlyCount)}
            </dd>
          </div>
          <div className="flex justify-between gap-6">
            <dt>Awaiting analysis</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {formatNumber(basis.awaitingAnalysisCount)}
            </dd>
          </div>
          <div className="flex justify-between gap-6">
            <dt>In an unsupported language</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {formatNumber(basis.notAnalyzableCount)}
            </dd>
          </div>
          <div className="flex justify-between gap-6">
            <dt>Not analysed for topics</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {formatNumber(basis.preAspectAnalysisCount)}
            </dd>
          </div>
        </dl>
      </details>
    </div>
  )
}

function formatSupportingReviewDate(localDate: string): string {
  return formatLocalDate(localDate) ?? localDate
}

function SupportingReview({
  propertyId,
  review,
}: Readonly<{ propertyId: string; review: AiTrendSupportingReviewView }>) {
  const date = formatSupportingReviewDate(review.localDate)
  const label = `${review.window === 'current' ? 'Current period' : 'Previous period'} · ${date}`
  // No item this viewer may open: the evidence stays readable, without a dead link.
  if (review.inboxItemId === null) {
    return (
      <span className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm text-muted-foreground">
        {label}
      </span>
    )
  }
  return (
    <Link
      to="/properties/$propertyId/reviews"
      params={{ propertyId }}
      search={{ itemId: review.inboxItemId }}
      aria-label={`Open supporting review from ${date} in the inbox`}
      className={cn(
        ROW_FIGURE_LINK,
        'inline-flex min-h-11 items-center rounded-md border px-3 text-sm hover:bg-muted/40',
      )}
    >
      {label}
    </Link>
  )
}

export function TrendSupportingReviews({
  propertyId,
  reviews,
}: Readonly<{ propertyId: string; reviews: readonly AiTrendSupportingReviewView[] }>) {
  if (reviews.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">Supporting reviews</p>
      <ul className="flex flex-wrap gap-2">
        {reviews.slice(0, 5).map((review) => (
          <li key={review.reviewId}>
            <SupportingReview propertyId={propertyId} review={review} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The headline sentence is read beside the page and used to pop in above the
 * topics, moving them down. While it is still on its way its line is held, one
 * heading high; if it turns out there is none, the line goes and the page closes
 * up, which only happens for a property with no trend report.
 */
function TrendHeadline({
  trend,
  pending,
  propertyId,
}: Readonly<{
  trend: AiTrendReportView | undefined
  pending: boolean
  propertyId: string
}>) {
  if (pending) {
    return <Skeleton className="h-7 w-3/4 max-w-3xl" aria-hidden="true" />
  }
  if (trend?.status !== 'ready') return null
  const sentence =
    trend.report.sentences?.[0] ?? trend.report.summary ?? trend.report.headline
  if (!sentence) return null
  const text = /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
  return (
    <section aria-labelledby="guest-voice-headline" className="flex flex-col gap-3">
      <h2
        id="guest-voice-headline"
        className="max-w-3xl text-lg font-semibold tracking-tight"
      >
        {text}
      </h2>
      <TrendSupportingReviews
        propertyId={propertyId}
        reviews={trend.evidence.supportingReviews}
      />
    </section>
  )
}

export function PropertyGuestVoicePage({
  propertyId,
  propertyName,
  range,
  onRangeChange,
  result,
  serverFns,
  busy = false,
}: Readonly<{
  propertyId: string
  propertyName: string
  range: DashboardRange
  onRangeChange: (range: DashboardRange) => void
  result: AiPropertyInsightsRead
  serverFns: PropertyGuestVoiceServerFns
  /** The next range is being read: the page shown is the previous range's, dimmed. */
  busy?: boolean
}>) {
  const trend = useQuery({
    queryKey: aiKeys.propertyTrend(propertyId),
    queryFn: () => serverFns.getTrend({ data: { propertyId } }),
    staleTime: 60_000,
    retry: false,
    enabled: result.status === 'ready',
  })

  return (
    <PageShell tier="dashboard">
      <PageHeader
        title="Guest voice"
        description="What guests praise, what needs attention, and how the picture is changing."
        breadcrumbs={trailCrumbs(
          'property',
          { propertyId, propertyName },
          NAV_LABEL.guests,
        )}
        actions={<DashboardRangeControl range={range} onRangeChange={onRangeChange} />}
      />

      <RangeBusyRegion busy={busy}>
        {result.status !== 'ready' ? (
          <GuestVoiceState result={result} range={range} propertyId={propertyId} />
        ) : (
          <div className="flex flex-col gap-6">
            <TrendHeadline
              trend={trend.data}
              pending={trend.isPending}
              propertyId={propertyId}
            />
            <PropertyGuestVoiceBasis result={result} />
            <section aria-labelledby="guest-voice-topics" className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h2
                  id="guest-voice-topics"
                  className="text-lg font-semibold tracking-tight"
                >
                  <GlossaryTerm term="topics" />
                </h2>
                <p className="text-sm text-muted-foreground">
                  One row per topic found in analysed review text.
                </p>
              </div>
              <PropertyInsightsTopicTable propertyId={propertyId} evidence={result} />
            </section>
            <section
              aria-labelledby="guest-voice-emerging-issues"
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1">
                <h2
                  id="guest-voice-emerging-issues"
                  className="text-lg font-semibold tracking-tight"
                >
                  <GlossaryTerm term="emerging-issues" />
                </h2>
                <p className="text-sm text-muted-foreground">
                  Specific recurring problems found in analysed review text.
                </p>
              </div>
              <PropertyInsightsEmergingIssues evidence={result} />
            </section>
          </div>
        )}
      </RangeBusyRegion>
    </PageShell>
  )
}
