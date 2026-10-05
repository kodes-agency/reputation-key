import type {
  GoogleReviewTargetAnalytics,
  PrivateFeedbackTargetAnalytics,
} from '#/contexts/inbox/application/public-api'
import { Metric, MetricStrip, MetricValue } from '#/components/ui/metric-strip'
import { formatNumber } from '#/lib/format'

/** What a measure with no figure says in the figure's place: a note, not a number. */
const NO_DATA = 'Not enough measured data'

/** The average in hours, or null while there is nothing measured to average. */
function formatAverage(minutes: number | null): string | null {
  if (minutes === null) return null
  const hours = minutes / 60
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} hours`
}

function AnalyticsGrid({
  name,
  rows,
}: Readonly<{ name: string; rows: ReadonlyArray<readonly [string, string | null]> }>) {
  return (
    <MetricStrip aria-label={name} variant="tiles" columns={3}>
      {rows.map(([label, value]) => (
        <Metric key={label} label={label}>
          <MetricValue value={value} detail={value === null ? NO_DATA : undefined} />
        </Metric>
      ))}
    </MetricStrip>
  )
}

export function PrivateFeedbackTargetSummary({
  analytics,
}: Readonly<{ analytics: PrivateFeedbackTargetAnalytics }>) {
  const rows = [
    ['Measured cycles', formatNumber(analytics.measuredCycleCount)],
    ['Currently open', formatNumber(analytics.activeCount)],
    ['Target time passed', formatNumber(analytics.currentOverdueCount)],
    ['Completed within target', formatNumber(analytics.handledOnTimeCount)],
    ['Completed after target', formatNumber(analytics.handledLateCount)],
    ['Reopened cycles', formatNumber(analytics.reopenCount)],
    [
      'Average time to first handling',
      formatAverage(analytics.averageTimeToFirstHandlingMinutes),
    ],
  ] as const
  return <AnalyticsGrid name="Private feedback response targets" rows={rows} />
}

export function GoogleReviewTargetSummary({
  analytics,
}: Readonly<{ analytics: GoogleReviewTargetAnalytics }>) {
  const rows = [
    ['Measured cycles', formatNumber(analytics.measuredCycleCount)],
    ['Currently open', formatNumber(analytics.activeCount)],
    ['Target time passed', formatNumber(analytics.currentOverdueCount)],
    ['Responded within target', formatNumber(analytics.respondedOnTimeCount)],
    ['Responded after target', formatNumber(analytics.respondedLateCount)],
    ['Reopened cycles', formatNumber(analytics.reopenCount)],
    [
      'Average time until observed live on Google',
      formatAverage(analytics.averageTimeToResponseMinutes),
    ],
    [
      'Onboarding history excluded',
      formatNumber(analytics.historicalOnboardingExcludedCount),
    ],
    [
      'Older records without timing proof',
      formatNumber(analytics.legacyUnknownExcludedCount),
    ],
  ] as const
  return <AnalyticsGrid name="Google review response targets" rows={rows} />
}
