import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Clock, Info, SearchX } from 'lucide-react'
import { DashboardRangeControl } from '#/components/features/dashboard/dashboard-range-control'
import { GlossaryTerm } from '#/components/features/shared/glossary-term'
import { PageHeader } from '#/components/layout/page-header'
import { PageShell } from '#/components/layout/page-shell'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import type {
  AiPropertyInsightsRead,
  AiTrendReportRead,
} from '#/contexts/ai/application/public-api'
import type { getPropertyAiTrendFn } from '#/contexts/ai/server/property-trend'
import type { DashboardRange } from '#/shared/dashboard-range'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { aiKeys } from '#/shared/queries/query-keys'
import { PropertyInsightsTopicTable } from './property-insights-aspect-table'
import { PropertyInsightsEmergingIssues } from './property-insights-emerging-issues'

type ReadyInsights = Extract<AiPropertyInsightsRead, { status: 'ready' }>

export type PropertyGuestVoiceServerFns = Readonly<{
  getTrend: typeof getPropertyAiTrendFn
}>

function pluralized(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`
}

export function PropertyGuestVoiceBasis({ result }: Readonly<{ result: ReadyInsights }>) {
  const { basis } = result
  return (
    <div className="flex flex-col gap-2 text-sm text-muted-foreground">
      <p>
        Based on {pluralized(basis.reviewCount, 'review')} ·{' '}
        {basis.analyzedReviewCount.toLocaleString()} analysed
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
        <summary className="flex min-h-11 cursor-pointer items-center font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
          What is in this figure
        </summary>
        <dl className="grid gap-x-8 gap-y-2 pb-1 sm:grid-cols-2">
          <div className="flex justify-between gap-6">
            <dt>Reviews without text</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {basis.starOnlyCount.toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between gap-6">
            <dt>Awaiting analysis</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {basis.awaitingAnalysisCount.toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between gap-6">
            <dt>In an unsupported language</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {basis.notAnalyzableCount.toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between gap-6">
            <dt>Not analysed for topics</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {basis.preAspectAnalysisCount.toLocaleString()}
            </dd>
          </div>
        </dl>
      </details>
    </div>
  )
}

const SUPPORTING_REVIEW_DATE = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})

function formatSupportingReviewDate(localDate: string): string {
  return SUPPORTING_REVIEW_DATE.format(new Date(`${localDate}T00:00:00.000Z`))
}

function TrendHeadline({ trend }: Readonly<{ trend: AiTrendReportRead | undefined }>) {
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
      {trend.evidence.supportingReviews.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">Supporting reviews</p>
          <ul className="flex flex-wrap gap-2">
            {trend.evidence.supportingReviews.slice(0, 5).map((review) => {
              const date = formatSupportingReviewDate(review.localDate)
              return (
                <li key={review.reviewId}>
                  <a
                    href={review.href}
                    aria-label={`Open supporting review from ${date} in the inbox`}
                    className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm text-link underline-offset-4 hover:bg-muted/40 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {review.window === 'current' ? 'Current period' : 'Previous period'} ·{' '}
                    {date}
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function DisabledGuestVoice({ propertyId }: Readonly<{ propertyId: string }>) {
  const { can } = usePermissions()
  return (
    <Alert>
      <Info aria-hidden="true" />
      <AlertTitle>AI analysis is off for this property</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>
          Guest voice needs AI analysis. Nothing is sent to the AI provider until it is
          enabled.
        </p>
        {can('ai.manage') ? (
          <Button asChild size="sm">
            <Link to="/settings/ai" search={{ propertyId }}>
              Enable AI analysis
            </Link>
          </Button>
        ) : (
          <p>An account admin can enable it from Settings → AI &amp; replies.</p>
        )}
      </AlertDescription>
    </Alert>
  )
}

function GuestVoiceState({
  result,
  range,
  propertyId,
}: Readonly<{
  result: Exclude<AiPropertyInsightsRead, ReadyInsights>
  range: DashboardRange
  propertyId: string
}>) {
  if (result.status === 'disabled') return <DisabledGuestVoice propertyId={propertyId} />
  if (result.status === 'preparing') {
    return (
      <Alert>
        <Clock aria-hidden="true" />
        <AlertTitle>Guest voice is being prepared</AlertTitle>
        <AlertDescription>
          AI analysis is still settling. Topics appear as soon as there is enough review
          evidence.
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <Alert>
      <SearchX aria-hidden="true" />
      <AlertTitle>
        {range === 'all'
          ? 'Not enough review evidence in the available history'
          : 'Not enough review evidence in this period'}
      </AlertTitle>
      <AlertDescription>
        {range === 'all'
          ? 'No reviews were found within the available AI analysis history.'
          : 'No reviews were found in the selected period. Choose a longer range to look further back.'}
      </AlertDescription>
    </Alert>
  )
}

export function PropertyGuestVoicePage({
  propertyId,
  propertyName,
  range,
  onRangeChange,
  result,
  serverFns,
}: Readonly<{
  propertyId: string
  propertyName: string
  range: DashboardRange
  onRangeChange: (range: DashboardRange) => void
  result: AiPropertyInsightsRead
  serverFns: PropertyGuestVoiceServerFns
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
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: propertyName },
          { label: 'Guest voice' },
        ]}
        actions={<DashboardRangeControl range={range} onRangeChange={onRangeChange} />}
      />

      {result.status !== 'ready' ? (
        <GuestVoiceState result={result} range={range} propertyId={propertyId} />
      ) : (
        <div className="flex flex-col gap-6">
          <TrendHeadline trend={trend.data} />
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
    </PageShell>
  )
}
