import type { PortalAnalyticsData } from '#/contexts/reporting/portal-results/contracts'
import type { TimeRangePreset } from '#/contexts/reporting/portal-results/contracts'
import { emptyResults } from './portal-results-empty'
import { EmptyResultsPanel } from './portal-results-empty-panels'
import type { PortalResultsPlace } from './portal-results-place'
import { PortalResultsToolbar } from './portal-results-toolbar'
import { PortalResultsCards } from './portal-results-cards'
import { PortalResultsDetail } from './portal-results-detail'

type Props = Readonly<{
  data: PortalAnalyticsData
  timeRange: TimeRangePreset
  onTimeRangeChange: (timeRange: TimeRangePreset) => void
  busy?: boolean
  place?: PortalResultsPlace
}>

/** One question per card; the optional detail stays behind one disclosure. */
export function PortalAnalyticsContent({
  data,
  timeRange,
  onTimeRangeChange,
  busy = false,
  place,
}: Props) {
  const empty = emptyResults(data, {
    comparing: data.comparePeriod !== null,
    isLive: place?.isLive ?? true,
    scansCounted: place?.scansCounted ?? true,
  })
  return (
    <div className="@container flex flex-col gap-4 md:gap-6" aria-busy={busy}>
      <PortalResultsToolbar
        timeRange={timeRange}
        onTimeRangeChange={onTimeRangeChange}
        localDays={data.localDays}
        timezone={data.period.timezone}
        retentionActive={data.retentionActive}
      />
      {place?.skipPrivateRating ? (
        <p className="text-sm text-muted-foreground">
          This portal is set to skip the private rating, so it collects no new ratings or
          notes once published.
        </p>
      ) : null}
      <div className="flex flex-col gap-4 md:gap-6">
        {empty && empty.kind !== 'quiet' ? (
          <EmptyResultsPanel empty={empty} place={place} />
        ) : (
          <>
            <PortalResultsCards data={data} place={place} />
            <PortalResultsDetail data={data} />
          </>
        )}
      </div>
    </div>
  )
}
