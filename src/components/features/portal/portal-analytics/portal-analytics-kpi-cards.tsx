// The Portal results measures as cards. Each label says what the number counts:
// qualified scans (not page opens), private ratings, the average with its n,
// guests who opened Google (not every link click), and private notes.
import type {
  PortalAnalyticsData,
  PortalMetricEvidence,
} from '#/contexts/reporting/application/public-api'
import type { TimeRangePreset } from '#/contexts/reporting/application/dto/dashboard.dto'
import { ratingPresentation } from '#/components/features/dashboard/rating-presentation'
import type { MetricEvidenceSubject } from '#/components/features/dashboard/metric-availability-presentation'
import { StatCard } from '#/components/features/shared/stat-card'
import { countComparisonHint } from './portal-count-hint'

type CountCardProps = Readonly<{
  label: string
  subject: MetricEvidenceSubject
  kpi: PortalAnalyticsData['kpis']['scans']
  timeZone: string
}>

function availabilityOf(
  subject: MetricEvidenceSubject,
  evidence: PortalMetricEvidence,
  timeZone: string,
) {
  return {
    subject,
    state: evidence.state,
    dataThrough: evidence.verifiedThrough,
    reason: evidence.availabilityReason,
    timeZone,
  }
}

function CountCard({ label, subject, kpi, timeZone }: CountCardProps) {
  return (
    <StatCard
      label={label}
      value={kpi.value === null ? '—' : kpi.value.toLocaleString('en-US')}
      hint={countComparisonHint(kpi)}
      availability={availabilityOf(subject, kpi.evidence, timeZone)}
    />
  )
}

export function PortalKpiCards({
  kpis,
  timeRange,
  timeZone,
}: Readonly<{
  kpis: PortalAnalyticsData['kpis']
  timeRange: TimeRangePreset
  timeZone: string
}>) {
  const rating = ratingPresentation(kpis.avgRating, timeRange)
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      <CountCard
        label="Qualified scans"
        subject="qualified_scans"
        kpi={kpis.scans}
        timeZone={timeZone}
      />
      <CountCard
        label="Private ratings"
        subject="ratings"
        kpi={kpis.ratings}
        timeZone={timeZone}
      />
      <StatCard
        label={rating.label}
        value={rating.value}
        hint={
          <>
            <span>{rating.comparison}</span>
            {kpis.avgRating.evidence.state === 'ready' ? (
              <span className="block">{rating.evidence}</span>
            ) : null}
          </>
        }
        availability={availabilityOf('ratings', kpis.avgRating.evidence, timeZone)}
      />
      <CountCard
        label="Guests who opened Google"
        subject="google_opens"
        kpi={kpis.googleOpens}
        timeZone={timeZone}
      />
      <CountCard
        label="Private notes"
        subject="private_feedback"
        kpi={kpis.feedback}
        timeZone={timeZone}
      />
    </div>
  )
}
