import { useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { SectionTitle } from '#/components/ui/section-title'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { MetricStrip, Metric, MetricValue } from '#/components/ui/metric-strip'
import { useStaffResults } from './use-staff-results'
import { useStaffAccounts } from './staff-accounts-context'
import { highRatingFromFewGuests } from './staff-rating-hint'
import {
  staffDaysSince,
  staffLastScanWords,
  staffNoScansLately,
} from './staff-no-scans-lately'
import { StaffRatingHint } from './staff-portal-meta'
import type { StaffMember } from './staff-account-view'

type Period = 'today' | 'week' | 'month' | 'last-month'
const PERIODS: readonly Readonly<{ value: Period; label: string }>[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
]

export function StaffPersonResults({
  member,
  propertyId,
}: Readonly<{ member: StaffMember; propertyId: string }>) {
  const [period, setPeriod] = useState<Period>('month')
  const results = useStaffResults(propertyId, period)
  const accounts = useStaffAccounts()
  const row = results.data?.portals.find((portal) => portal.portalId === member.portalId)
  const zone = results.data?.properties.find(
    (property) => property.propertyId === propertyId,
  )?.timezone
  const now = row?.kpis.scans.evidence.computedAt ?? new Date()
  const days = zone && row ? staffDaysSince(row.lastScanAt, now, zone) : null
  const personalIds = new Set(accounts?.members.map((person) => person.portalId))
  const hint =
    member.portalId &&
    highRatingFromFewGuests(
      (results.data?.portals ?? [])
        .filter((portal) => personalIds.has(portal.portalId))
        .map((portal) => ({
          portalId: portal.portalId,
          scans: portal.kpis.scans.value,
          ratings: portal.kpis.ratings.value,
          average: portal.kpis.avgRating.value,
        })),
    ).has(member.portalId)
  const quiet =
    zone &&
    row &&
    row.kpis.scans.evidence.state === 'ready' &&
    staffNoScansLately({ ...member, lastScanAt: row.lastScanAt, now, timeZone: zone })
  return (
    <section className="space-y-3" aria-label="Results">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle>Results</SectionTitle>
        <Select
          value={period}
          onValueChange={(value) => {
            const next = PERIODS.find((option) => option.value === value)
            if (next) setPeriod(next.value)
          }}
        >
          <SelectTrigger aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <FormErrorBanner error={results.error} />
      <MetricStrip aria-label="Results" variant="boxed">
        <Metric label="Scans">
          <MetricValue value={row?.kpis.scans.value ?? null} />
        </Metric>
        <Metric label="Ratings">
          <MetricValue value={row?.kpis.ratings.value ?? null} />
        </Metric>
        <Metric label="Average">
          <MetricValue value={row?.kpis.avgRating.value ?? null} />
        </Metric>
        <Metric label="Private notes">
          <MetricValue value={row?.kpis.feedback.value ?? null} />
        </Metric>
        <Metric label="Opened Google">
          <MetricValue value={row?.kpis.googleOpens.value ?? null} />
        </Metric>
        <Metric label="Last scan">
          <MetricValue value={staffLastScanWords(days)} />
        </Metric>
      </MetricStrip>
      {hint ? <StaffRatingHint /> : null}
      {quiet ? <p className="text-sm text-muted-foreground">No scans lately</p> : null}
    </section>
  )
}
