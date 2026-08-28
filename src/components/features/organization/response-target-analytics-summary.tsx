import type {
  GoogleReviewTargetAnalytics,
  PrivateFeedbackTargetAnalytics,
} from '#/contexts/inbox/application/public-api'

function formatAverage(minutes: number | null): string {
  if (minutes === null) return 'Not enough measured data'
  const hours = minutes / 60
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} hours`
}

function AnalyticsGrid({
  rows,
}: Readonly<{ rows: ReadonlyArray<readonly [string, string]> }>) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-muted/45 p-3">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 font-medium tabular-nums">{value}</p>
        </div>
      ))}
    </div>
  )
}

export function PrivateFeedbackTargetSummary({
  analytics,
}: Readonly<{ analytics: PrivateFeedbackTargetAnalytics }>) {
  const rows = [
    ['Measured cycles', analytics.measuredCycleCount.toLocaleString('en-US')],
    ['Currently open', analytics.activeCount.toLocaleString('en-US')],
    ['Target time passed', analytics.currentOverdueCount.toLocaleString('en-US')],
    ['Completed within target', analytics.handledOnTimeCount.toLocaleString('en-US')],
    ['Completed after target', analytics.handledLateCount.toLocaleString('en-US')],
    ['Reopened cycles', analytics.reopenCount.toLocaleString('en-US')],
    [
      'Average time to first handling',
      formatAverage(analytics.averageTimeToFirstHandlingMinutes),
    ],
  ] as const
  return <AnalyticsGrid rows={rows} />
}

export function GoogleReviewTargetSummary({
  analytics,
}: Readonly<{ analytics: GoogleReviewTargetAnalytics }>) {
  const rows = [
    ['Measured cycles', analytics.measuredCycleCount.toLocaleString('en-US')],
    ['Currently open', analytics.activeCount.toLocaleString('en-US')],
    ['Target time passed', analytics.currentOverdueCount.toLocaleString('en-US')],
    ['Responded within target', analytics.respondedOnTimeCount.toLocaleString('en-US')],
    ['Responded after target', analytics.respondedLateCount.toLocaleString('en-US')],
    ['Reopened cycles', analytics.reopenCount.toLocaleString('en-US')],
    [
      'Average time until observed live on Google',
      formatAverage(analytics.averageTimeToResponseMinutes),
    ],
    [
      'Onboarding history excluded',
      analytics.historicalOnboardingExcludedCount.toLocaleString('en-US'),
    ],
    [
      'Older records without timing proof',
      analytics.legacyUnknownExcludedCount.toLocaleString('en-US'),
    ],
  ] as const
  return <AnalyticsGrid rows={rows} />
}
