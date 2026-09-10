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
import { RatingDistributionChart } from '#/components/features/shared/rating-distribution-chart'
import { PageHeader } from '#/components/layout/page-header'
import { PageShell } from '#/components/layout/page-shell'
import {
  PROPERTY_INSIGHTS_RANGE_DAYS,
  isPropertyInsightsRangeDays,
  type AiPropertyInsightsBasis,
  type AiPropertyInsightsRead,
  type PropertyInsightsRangeDays,
} from '#/contexts/ai/application/public-api'
import {
  PropertyInsightsAspectTable,
  PropertyInsightsEmergingIssues,
} from './property-insights-aspect-table'
import { PropertyInsightsWeeklyChart } from './property-insights-weekly-chart'

const RANGE_LABELS: Readonly<Record<PropertyInsightsRangeDays, string>> = {
  30: '30 days',
  90: '90 days',
  180: '180 days',
}

function pluralized(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

const LOCAL_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})

function formatLocalDate(localDate: string): string {
  return LOCAL_DATE_FORMATTER.format(new Date(`${localDate}T00:00:00.000Z`))
}

function PropertyInsightsRangeControl({
  rangeDays,
  onRangeChange,
}: Readonly<{
  rangeDays: PropertyInsightsRangeDays
  onRangeChange: (rangeDays: PropertyInsightsRangeDays) => void
}>) {
  return (
    <>
      <div className="sm:hidden">
        <Select
          value={String(rangeDays)}
          onValueChange={(value) => {
            const parsed = Number(value)
            if (isPropertyInsightsRangeDays(parsed)) onRangeChange(parsed)
          }}
        >
          <SelectTrigger aria-label="Insights range" className="min-h-11 min-w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {PROPERTY_INSIGHTS_RANGE_DAYS.map((range) => (
                <SelectItem key={range} value={String(range)}>
                  {RANGE_LABELS[range]}
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
        {PROPERTY_INSIGHTS_RANGE_DAYS.map((range) => (
          <Button
            key={range}
            type="button"
            className="h-11 min-w-20"
            variant={rangeDays === range ? 'secondary' : 'ghost'}
            aria-pressed={rangeDays === range}
            onClick={() => onRangeChange(range)}
          >
            {RANGE_LABELS[range]}
          </Button>
        ))}
      </div>
    </>
  )
}

function PropertyInsightsHeader({
  propertyName,
  rangeDays,
  onRangeChange,
}: Readonly<{
  propertyName: string
  rangeDays: PropertyInsightsRangeDays
  onRangeChange: (rangeDays: PropertyInsightsRangeDays) => void
}>) {
  return (
    <PageHeader
      title={`${propertyName} insights`}
      description="What guests praise, what needs attention, and how the picture is changing."
      actions={
        <PropertyInsightsRangeControl
          rangeDays={rangeDays}
          onRangeChange={onRangeChange}
        />
      }
    />
  )
}

function PropertyInsightsBasisLine({
  basis,
  dataThroughLocalDate,
}: Readonly<{
  basis: AiPropertyInsightsBasis
  dataThroughLocalDate: string
}>) {
  return (
    <p className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
      Based on {pluralized(basis.reviewCount, 'review')} · {basis.analyzedReviewCount}{' '}
      analysed · {basis.starOnlyCount} star-only
      {basis.notAnalyzableCount > 0 && (
        <> · {basis.notAnalyzableCount} not analysable in a supported language</>
      )}
      {basis.awaitingAnalysisCount > 0 && (
        <> · {basis.awaitingAnalysisCount} awaiting analysis</>
      )}{' '}
      · data through {formatLocalDate(dataThroughLocalDate)}
    </p>
  )
}

function ReportState({
  status,
}: Readonly<{ status: 'disabled' | 'preparing' | 'insufficient_data' }>) {
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
          No figures are shown until the daily totals agree with the reviews behind them.
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <Alert>
      <SearchX aria-hidden="true" />
      <AlertTitle>Not enough review evidence in this period</AlertTitle>
      <AlertDescription>
        No reviews were found in the selected period. Choose a longer range to look
        further back.
      </AlertDescription>
    </Alert>
  )
}

function PropertyInsightsRatingDistribution({
  basis,
}: Readonly<{ basis: AiPropertyInsightsBasis }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 id="insights-rating-distribution-title">Rating distribution</h2>
        </CardTitle>
        <CardDescription>
          Star-only reviews are included here and excluded from aspect counts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RatingDistributionChart
          distribution={basis.ratingDistribution}
          labelledBy="insights-rating-distribution-title"
        />
      </CardContent>
    </Card>
  )
}

export function PropertyInsightsReport({
  propertyId,
  propertyName,
  rangeDays,
  onRangeChange,
  result,
}: Readonly<{
  propertyId: string
  propertyName: string
  rangeDays: PropertyInsightsRangeDays
  onRangeChange: (rangeDays: PropertyInsightsRangeDays) => void
  result: AiPropertyInsightsRead
}>) {
  return (
    <PageShell tier="dashboard">
      <PropertyInsightsHeader
        propertyName={propertyName}
        rangeDays={rangeDays}
        onRangeChange={onRangeChange}
      />

      {result.status !== 'ready' ? (
        <ReportState status={result.status} />
      ) : (
        <>
          <PropertyInsightsBasisLine
            basis={result.basis}
            dataThroughLocalDate={result.dataThroughLocalDate}
          />

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Aspect impact</h2>
              </CardTitle>
              <CardDescription>
                Mentions and rating-weighted impact, compared with the immediately
                preceding {result.rangeDays}-day period. Open any row to see its reviews
                in the inbox.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PropertyInsightsAspectTable
                propertyId={propertyId}
                aspects={result.aspects}
                analyzedReviewCount={result.basis.analyzedReviewCount}
              />
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
                  analyzedReviewCount={result.basis.analyzedReviewCount}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Emerging issues</h2>
                </CardTitle>
                <CardDescription>
                  Repeated issue labels and their change from the preceding period.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PropertyInsightsEmergingIssues
                  issues={result.emergingIssues}
                  analyzedReviewCount={result.basis.analyzedReviewCount}
                />
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
