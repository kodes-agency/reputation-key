// The Results tab (board 07): the range and the comparison, the five measures,
// the path from scan to Google, the rating mix, guests by language and the
// weekly view. All Time reads from the lifetime totals, which have no weeks, so
// it shows the totals and says why the weekly view is not there.
import { useId } from 'react'
import { BarChart3 } from 'lucide-react'
import type { PortalAnalyticsData } from '#/contexts/reporting/application/public-api'
import type { TimeRangePreset } from '#/contexts/reporting/application/dto/dashboard.dto'
import { PortalLifetimeReconciliationSummary } from './portal-lifetime-reconciliation-summary'
import { PortalResultsAbout } from './portal-results-about'
import { resultsCells } from './portal-results-cells'
import { PortalResultsFunnel } from './portal-results-funnel'
import { PortalResultsLanguages } from './portal-results-language-list'
import { PortalResultsRatingMix } from './portal-results-rating-mix'
import { PortalResultsSeries } from './portal-results-series'
import { PortalResultsStrip } from './portal-results-strip'
import { PortalResultsToolbar } from './portal-results-toolbar'
import { windowFooter } from './portal-results-window'

type Props = Readonly<{
  data: PortalAnalyticsData
  timeRange: TimeRangePreset
  onTimeRangeChange: (timeRange: TimeRangePreset) => void
  compare: boolean
  onCompareChange: (compare: boolean) => void
}>

function hasAnyFigure(data: PortalAnalyticsData): boolean {
  const { kpis } = data
  return (
    (kpis.scans.value ?? 0) > 0 ||
    (kpis.feedback.value ?? 0) > 0 ||
    (kpis.googleOpens.value ?? 0) > 0 ||
    kpis.avgRating.sampleCount > 0 ||
    data.responseIntegrity.total > 0
  )
}

function hasPendingState(data: PortalAnalyticsData): boolean {
  const { kpis } = data
  return [kpis.scans, kpis.ratings, kpis.avgRating, kpis.feedback, kpis.googleOpens].some(
    ({ evidence }) =>
      evidence.state === 'updating' || evidence.state === 'temporarily_unavailable',
  )
}

function EmptyResults() {
  return (
    <div className="rounded-lg border border-dashed p-12 text-center">
      <BarChart3 className="mx-auto size-10 text-muted-foreground/50" />
      <h3 className="mt-4 font-semibold">No data yet</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Share your portal to start collecting metrics.
      </p>
    </div>
  )
}

export function PortalAnalyticsContent({
  data,
  timeRange,
  onTimeRangeChange,
  compare,
  onCompareChange,
}: Props) {
  const funnelId = useId()
  const mixId = useId()
  const languagesId = useId()
  const timezone = data.period.timezone
  // Clicks exist but cannot be told apart: an empty page would be a false "no data".
  const hasWithheldGoogleOpens =
    data.kpis.googleOpens.evidence.availabilityReason === 'destination_unattributed'
  const empty = !hasAnyFigure(data) && !hasPendingState(data) && !hasWithheldGoogleOpens
  // "All time" has no prior window, so there is nothing to switch on or off.
  const comparing = compare && data.comparePeriod !== null

  return (
    <div className="@container space-y-8">
      <PortalResultsToolbar
        timeRange={timeRange}
        onTimeRangeChange={onTimeRangeChange}
        compare={compare}
        onCompareChange={onCompareChange}
        localDays={data.localDays}
        timezone={timezone}
      />
      {data.lifetimeReconciliation === null ? null : (
        <PortalLifetimeReconciliationSummary
          state={data.lifetimeReconciliation}
          timeZone={timezone}
        />
      )}
      {empty ? (
        <EmptyResults />
      ) : (
        <>
          <PortalResultsStrip cells={resultsCells(data, { compare: comparing })} />
          <div className="grid gap-x-10 gap-y-10 @4xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <div className="space-y-10">
              <section aria-labelledby={funnelId} className="space-y-4">
                <h3 id={funnelId} className="text-base font-semibold">
                  From scan to Google
                </h3>
                <PortalResultsFunnel
                  funnel={data.engagementFunnel}
                  qualifiedScansSince={data.qualifiedScansSince}
                  privateNotes={data.kpis.feedback.value}
                  headingId={funnelId}
                />
              </section>
              <div className="grid gap-x-8 gap-y-10 @2xl:grid-cols-2">
                <section aria-labelledby={mixId}>
                  <PortalResultsRatingMix data={data} headingId={mixId} />
                </section>
                <section aria-labelledby={languagesId}>
                  <PortalResultsLanguages
                    breakdown={data.ratingLanguages}
                    headingId={languagesId}
                  />
                </section>
              </div>
            </div>
            <PortalResultsSeries
              data={data}
              timeRange={timeRange}
              comparing={comparing}
            />
          </div>
        </>
      )}
      <footer className="flex flex-wrap items-start justify-between gap-x-6 border-t pt-2">
        <p className="min-h-11 flex-1 basis-80 py-3 text-xs text-muted-foreground">
          {data.localDays === null
            ? `All time, ${timezone} time · Averages compare only between periods with at least ${data.thresholds.comparisonMinSample} private ratings each.`
            : windowFooter(
                comparing
                  ? data.localDays
                  : { ...data.localDays, compareStart: null, compareEnd: null },
                timezone,
                data.thresholds.comparisonMinSample,
              )}
        </p>
        <div className="min-w-0 flex-1 basis-80">
          <PortalResultsAbout
            data={data}
            showEvidence={data.lifetimeReconciliation === null}
          />
        </div>
      </footer>
    </div>
  )
}
