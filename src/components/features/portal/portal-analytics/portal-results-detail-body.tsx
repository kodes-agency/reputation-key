// What "More detail" holds: the table behind the chart, the star mix and how each
// figure is counted. It is its own chunk, so the page a manager glances at does
// not carry what few of them open.
import { useId } from 'react'
import type { PortalAnalyticsData } from '#/contexts/reporting/application/public-api'
import { SectionTitle } from '#/components/ui/section-title'
import { PortalResultsAbout } from './portal-results-about'
import { PortalResultsRatingMix } from './portal-results-rating-mix'
import { PortalResultsSeriesTable } from './portal-results-series-table'
import { priorPeriodLabel } from './portal-results-window'

export default function PortalResultsDetailBody({
  data,
}: Readonly<{ data: PortalAnalyticsData }>) {
  const mixId = useId()
  return (
    <div className="space-y-6 pt-4">
      {data.series && data.localDays ? (
        <section className="space-y-3">
          <SectionTitle>
            {data.series.bucketDays === 1 ? 'Day by day' : 'Week by week'}
          </SectionTitle>
          <PortalResultsSeriesTable
            series={data.series}
            versionMarkers={data.versionMarkers}
            showPrior={data.comparePeriod !== null}
            priorLabel={priorPeriodLabel(data.localDays)}
          />
        </section>
      ) : null}
      <section aria-labelledby={mixId}>
        <PortalResultsRatingMix data={data} headingId={mixId} />
      </section>
      <PortalResultsAbout
        data={data}
        showEvidence={data.lifetimeReconciliation === null}
      />
    </div>
  )
}
