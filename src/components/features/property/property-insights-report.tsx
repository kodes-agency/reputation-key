import { BarChart3, Clock, Info, SearchX } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { PageHeader } from '#/components/layout/page-header'
import { PageShell } from '#/components/layout/page-shell'
import {
  PROPERTY_INSIGHTS_RANGES,
  isPropertyInsightsRange,
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

const RANGE_LABELS: Readonly<Record<PropertyInsightsRange, string>> = {
  30: '30 days',
  90: '90 days',
  180: '180 days',
  all: 'All Time',
}

function pluralized(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

const LOCAL_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})
const formatLocalDate = (localDate: string): string =>
  LOCAL_DATE_FORMATTER.format(new Date(`${localDate}T00:00:00.000Z`))

function PropertyInsightsRangeControl({
  range,
  onRangeChange,
}: Readonly<{
  range: PropertyInsightsRange
  onRangeChange: (range: PropertyInsightsRange) => void
}>) {
  return (
    <>
      <div className="sm:hidden">
        <Select
          value={String(range)}
          onValueChange={(value) => {
            const parsed = value === 'all' ? value : Number(value)
            if (isPropertyInsightsRange(parsed)) onRangeChange(parsed)
          }}
        >
          <SelectTrigger aria-label="Insights range" className="min-h-11 min-w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {PROPERTY_INSIGHTS_RANGES.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {RANGE_LABELS[option]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div
        role="group"
        aria-label="Insights range"
        className="hidden items-center gap-1 sm:flex"
      >
        {PROPERTY_INSIGHTS_RANGES.map((option) => (
          <Button
            key={option}
            type="button"
            className="h-11 min-w-20"
            variant={range === option ? 'secondary' : 'ghost'}
            aria-pressed={range === option}
            onClick={() => onRangeChange(option)}
          >
            {RANGE_LABELS[option]}
          </Button>
        ))}
      </div>
    </>
  )
}

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

function ReportState({
  status,
  range,
}: Readonly<{
  status: 'disabled' | 'preparing' | 'insufficient_data'
  range: PropertyInsightsRange
}>) {
  if (status === 'disabled') {
    return (
      <Alert>
        <Info aria-hidden="true" />
        <AlertTitle>Insights are not available for this property</AlertTitle>
        <AlertDescription>
          Review Analysis is currently disabled, so this report has no evidence to show.
        </AlertDescription>
      </Alert>
    )
  }
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

export function PropertyInsightsReport({
  propertyId,
  propertyName,
  range,
  onRangeChange,
  result,
}: Readonly<{
  propertyId: string
  propertyName: string
  range: PropertyInsightsRange
  onRangeChange: (range: PropertyInsightsRange) => void
  result: AiPropertyInsightsRead
}>) {
  return (
    <PageShell tier="dashboard">
      <PageHeader
        title={`${propertyName} insights`}
        description="What guests praise, what needs attention, and how the picture is changing."
        actions={
          <PropertyInsightsRangeControl range={range} onRangeChange={onRangeChange} />
        }
      />

      {result.status !== 'ready' ? (
        <ReportState status={result.status} range={range} />
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
