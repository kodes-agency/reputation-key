import { Link } from '@tanstack/react-router'
import { BarChart3, Clock, Info, SearchX } from 'lucide-react'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { DashboardRangeControl } from '#/components/features/dashboard/dashboard-range-control'
import { toInsightsRange, type DashboardRange } from '#/shared/dashboard-range'
import { PageHeader } from '#/components/layout/page-header'
import { PageShell } from '#/components/layout/page-shell'
import {
  type AiPropertyInsightsBasis,
  type AiPropertyInsightsRead,
  type PropertyInsightsRange,
} from '#/contexts/ai/application/public-api'
import {
  PropertyInsightsAspectTable,
  PropertyInsightsEmergingIssues,
} from './property-insights-aspect-table'
import { PropertyInsightsWeeklyChart } from './property-insights-weekly-chart'
import { PropertyAiProvisionalNotice } from './property-ai-provisional-notice'
import { PropertyInsightsRatingDistribution } from './property-insights-rating-distribution'

function pluralized(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

const LOCAL_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})
const formatLocalDate = (localDate: string): string =>
  LOCAL_DATE_FORMATTER.format(new Date(`${localDate}T00:00:00.000Z`))

function PropertyInsightsBasisLine({
  basis,
  startLocalDate,
  dataThroughLocalDate,
  retentionLimited,
}: Readonly<{
  basis: AiPropertyInsightsBasis
  startLocalDate: string
  dataThroughLocalDate: string
  retentionLimited: boolean
}>) {
  return (
    <p className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
      Based on {pluralized(basis.reviewCount, 'review')} · {basis.analyzedReviewCount}{' '}
      analysed with aspects · {basis.preAspectAnalysisCount} analysed before aspect
      analysis existed · {basis.starOnlyCount} star-only · {basis.notAnalyzableCount} not
      analysable in a supported language · {basis.awaitingAnalysisCount} awaiting analysis
      ·{' '}
      {retentionLimited
        ? `window starts at the 24-month retention horizon (${formatLocalDate(startLocalDate)})`
        : `window starts ${formatLocalDate(startLocalDate)}`}{' '}
      · data through {formatLocalDate(dataThroughLocalDate)}
    </p>
  )
}

function DisabledInsightsState({ propertyId }: Readonly<{ propertyId: string }>) {
  const { can } = usePermissions()
  // The second door to AI analysis after the import flow's own step: a
  // merchant who skipped it, or one whose property predates it, must not
  // land on a dead end here.
  return (
    <Alert>
      <Info aria-hidden="true" />
      <AlertTitle>Insights are not available for this property</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>
          Review Analysis is off for this property, so this report has no evidence to
          show. Nothing is sent to the AI provider until it is enabled.
        </p>
        {can('ai.manage') ? (
          <div>
            <Button asChild size="sm">
              <Link to="/settings/ai" search={{ propertyId }}>
                Enable AI analysis
              </Link>
            </Button>
          </div>
        ) : (
          <p>An account admin can enable it from Settings → AI &amp; replies.</p>
        )}
      </AlertDescription>
    </Alert>
  )
}

function ReportState({
  status,
  range,
  propertyId,
}: Readonly<{
  status: 'disabled' | 'preparing' | 'insufficient_data'
  range: PropertyInsightsRange
  propertyId: string
}>) {
  if (status === 'disabled') return <DisabledInsightsState propertyId={propertyId} />
  if (status === 'preparing') {
    return (
      <Alert>
        <Clock aria-hidden="true" />
        <AlertTitle>Analysis for this property is still settling</AlertTitle>
        <AlertDescription>
          No usable figures are available yet. They appear as soon as usable review and
          analysis evidence is available.
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
          ? 'No reviews were found within the 24-month evidence retention horizon.'
          : 'No reviews were found in the selected period. Choose a longer range to look further back.'}
      </AlertDescription>
    </Alert>
  )
}

/**
 * Dashboard → Guest voice (redesign rows 1, 7c).
 *
 * PR 1 gives the page its own route, name and the shared range; the contents
 * are unchanged. PR 3 merges the overview's two AI sections into it, replaces
 * the aspect pseudo-table with one row per topic, and removes the weekly-trend,
 * sentiment and distribution charts from this page.
 */
export function PropertyInsightsReport({
  propertyId,
  propertyName,
  range,
  onRangeChange,
  result,
}: Readonly<{
  propertyId: string
  propertyName: string
  range: DashboardRange
  onRangeChange: (range: DashboardRange) => void
  result: AiPropertyInsightsRead
}>) {
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
        <ReportState
          status={result.status}
          range={toInsightsRange(range)}
          propertyId={propertyId}
        />
      ) : (
        <>
          {result.provisional && (
            <PropertyAiProvisionalNotice
              coverage={result.coverage}
              comparisonsSuppressed
            />
          )}

          <PropertyInsightsBasisLine
            basis={result.basis}
            startLocalDate={result.startLocalDate}
            dataThroughLocalDate={result.dataThroughLocalDate}
            retentionLimited={
              result.range === 'all' &&
              result.windowStartBasis === 'derivative_retention_horizon'
            }
          />

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Aspect impact</h2>
              </CardTitle>
              <CardDescription>
                {result.range === 'all'
                  ? 'Mentions and rating-weighted impact across the available review evidence in this window. Comparison is unavailable for All Time.'
                  : result.provisional
                    ? 'Mentions and rating-weighted impact across the analysed reviews available so far. Comparison is unavailable while analysis is still filling in.'
                    : `Mentions and rating-weighted impact, compared with the immediately preceding ${result.range}-day period.`}{' '}
                Open any row to see its reviews in the inbox.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PropertyInsightsAspectTable propertyId={propertyId} evidence={result} />
            </CardContent>
          </Card>

          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(18rem,1fr)]">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>
                  <h2>Weekly aspect trends</h2>
                </CardTitle>
                <CardDescription>
                  Weekly mention counts for the aspects with the strongest weighted impact
                  in this period.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PropertyInsightsWeeklyChart
                  series={result.weeklyAspectSeries}
                  aspectEvidenceState={result.aspectEvidenceState}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Emerging issues</h2>
                </CardTitle>
                <CardDescription>
                  {result.range === 'all'
                    ? 'Repeated issue labels across the available analysed history in this window. Comparison is unavailable for All Time.'
                    : result.provisional
                      ? 'Repeated issue labels across the analysed reviews available so far. Comparison is unavailable while analysis is still filling in.'
                      : 'Repeated issue labels and their change from the preceding period.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PropertyInsightsEmergingIssues evidence={result} />
              </CardContent>
            </Card>
          </div>

          <PropertyInsightsRatingDistribution basis={result.basis} />

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <BarChart3 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Weighted impact uses aspect-impact-v1 and is calculated from each analysed
            review&apos;s aspect intensity and star rating. Review text stays in the
            inbox.
          </p>
        </>
      )}
    </PageShell>
  )
}
