// The Profile views tile of the Overview scorecard (redesign rows 4, 12).
//
// The one Google number that belongs on the front page: how many people saw the
// profile in the last 30 days. Everything else Google reports lives on its own
// page.
//
// Self-fetching for the same reason the Google section is — the report is
// leased, and an unavailable integration must degrade this tile, not the page.
// The 30-day preset is fixed: Overview has no range control, and this is the
// window Google itself shows managers, so the figure matches what they see
// there (row 5).
import { OverviewTile, PULSE_COMPARISON_LABEL } from './overview-tile'
import { useGooglePerformance } from './use-google-performance'
import type { GooglePerformanceServerFns } from './use-google-performance'
import { isUnavailablePerformanceResult } from './google-performance-states'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { formatNumber } from '#/lib/format'
import { MetricDelta } from '#/components/ui/metric-delta'

export type OverviewProfileViewsServerFns = GooglePerformanceServerFns

export function OverviewProfileViews({
  propertyId,
  serverFns,
}: Readonly<{ propertyId: string; serverFns: OverviewProfileViewsServerFns }>) {
  const { can } = usePermissions()
  const performance = useGooglePerformance({ propertyId, preset: '30d', serverFns })

  const googleTile = (value: string | null, context: React.ReactNode) => (
    <OverviewTile
      label="Profile views"
      value={value}
      context={context}
      link={{ to: '/properties/$propertyId/google', params: { propertyId } }}
      linkLabel="Profile views — open Google Business Profile"
    />
  )

  if (performance.isPending) return googleTile(null, 'Reading Google…')

  const report = performance.retainedReport
  if (!report) {
    // Setup is missing rather than the report being late: the tile becomes the
    // action, because a tile cannot contain a link of its own.
    if (isUnavailablePerformanceResult(performance.result)) {
      return can('integration.manage') ? (
        <OverviewTile
          label="Profile views"
          value={null}
          context="Connect Google to see how people find you."
          link={{ to: '/settings/integrations', search: { propertyId } }}
          linkLabel="Connect Google"
        />
      ) : (
        googleTile(null, "Ask an account admin to finish this property's Google setup.")
      )
    }
    return googleTile(null, 'Google is not answering right now.')
  }

  const views = report.headlines.totalProfileImpressions
  if (views.value === null) {
    return googleTile(null, 'Google has not reported any complete days yet.')
  }

  return googleTile(
    formatNumber(views.value),
    <>
      in the last 30 days ·{' '}
      {views.deltaPercent === null ? (
        'no comparable period'
      ) : (
        <MetricDelta
          value={views.deltaPercent}
          unit="percent"
          fractionDigits={0}
          comparisonLabel={PULSE_COMPARISON_LABEL}
        />
      )}
    </>,
  )
}
