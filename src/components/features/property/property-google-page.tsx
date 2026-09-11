// Dashboard → Google (redesign rows 1, 7b).
//
// The Google report used to be the third section of a 4,161 px overview, with
// its own range picker beside the page's. It is its own page now: one heading,
// the shared range, and the report.
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import {
  DashboardRangeControl,
  RangeLimitNote,
} from '#/components/features/dashboard/dashboard-range-control'
import {
  GOOGLE_PERFORMANCE_RANGE_LIMIT,
  toPerformancePreset,
  type DashboardRange,
} from '#/shared/dashboard-range'
import { GooglePerformanceSection } from './google-performance-section'
import type { GooglePerformanceServerFns } from './use-google-performance'

export interface PropertyGooglePageProps {
  property: Readonly<{ id: string; name: string }> | null | undefined
  propertyId: string
  range: DashboardRange
  onRangeChange: (range: DashboardRange) => void
  performanceFns: GooglePerformanceServerFns
}

export function PropertyGooglePage({
  property,
  propertyId,
  range,
  onRangeChange,
  performanceFns,
}: PropertyGooglePageProps) {
  if (!property) return null

  return (
    <PageShell tier="dashboard">
      <PageHeader
        title="Google Business Profile"
        description="How people find you on Search and Maps, and what they do next."
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: property.name },
          { label: 'Google' },
        ]}
        actions={<DashboardRangeControl range={range} onRangeChange={onRangeChange} />}
      />

      <RangeLimitNote
        range={range}
        limit={GOOGLE_PERFORMANCE_RANGE_LIMIT}
        source="Google"
      />

      {/* The preset drives a leased report; remounting on change discards the
          retained one, which is the intended behaviour — a new range is a new
          report, not a filter over the old one. */}
      <GooglePerformanceSection
        key={`${propertyId}:${range}`}
        propertyId={propertyId}
        preset={toPerformancePreset(range)}
        serverFns={performanceFns}
      />
    </PageShell>
  )
}
