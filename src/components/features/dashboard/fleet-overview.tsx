// Fleet overview — cross-property landing for orgs with 2+ properties.
// Renders inside the `dashboard` tier. Rows use stable name/id keyset ordering;
// each row deep-links into that property's deep-dive.
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { dashboardKeys } from '#/shared/queries/query-keys'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { FleetLoadMore } from './fleet-load-more'
import { StripStat } from './fleet-totals-strip'
import { Building2, AlertCircle, Star } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { LoadingState, ErrorState } from '#/components/layout/page-states'
import {
  Stars,
  TrendIndicator,
} from '#/components/features/property/property-dashboard-helpers'
import type {
  FleetEntry,
  FleetMetricEvidence,
  FleetOverviewData,
} from '#/contexts/dashboard/application/public-api'
import { FleetAttentionBreakdown } from './fleet-attention-breakdown'

/** Shared shell + header so every fleet state (loading/error/empty/data) is consistent. */
function Shell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <PageShell tier="dashboard">
      <PageHeader title="Dashboard" description="Overview across all properties" />
      {children}
    </PageShell>
  )
}

const formatRating = (r: number): string => (r > 0 ? r.toFixed(1) : '—')
const formatRatingComparison = (comparison: number | null): string =>
  comparison === null ? '—' : `${comparison > 0 ? '+' : ''}${comparison.toFixed(1)} stars`

export function FleetOverviewLoading() {
  return (
    <Shell>
      <LoadingState label="Loading fleet overview…" />
    </Shell>
  )
}

export function FleetOverviewError({ message }: Readonly<{ message?: string }>) {
  const qc = useQueryClient()
  return (
    <Shell>
      <ErrorState
        message={message}
        onRetry={() => qc.invalidateQueries({ queryKey: dashboardKeys.fleet() })}
      />
    </Shell>
  )
}

export function FleetOverviewEmpty() {
  const { can } = usePermissions()
  return (
    <Shell>
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <h2 className="text-lg font-medium">No properties yet</h2>
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          Create your first property to manage reviews, staff performance, and reputation.
        </p>
        {can('property.import_gbp_v2') ? (
          <Button asChild>
            <Link to="/properties/import-google">Import property</Link>
          </Button>
        ) : null}
      </div>
    </Shell>
  )
}

export interface FleetOverviewProps {
  readonly data: FleetOverviewData
  /**
   * Absent in the story/fixture cases that render a single settled page. The
   * control only appears when the projection actually handed back a cursor.
   */
  readonly isFetchingNextPage?: boolean
  readonly onLoadMore?: () => void
}

export function FleetOverview({
  data,
  isFetchingNextPage = false,
  onLoadMore,
}: FleetOverviewProps) {
  const { entries, totals } = data
  return (
    <Shell>
      {/*
        BQC-6.8 reflow: single-column on narrow/zoomed viewports (the 3-up
        strip could not shrink below its min-content at 400% zoom / 320 CSS px
        — WCAG 1.4.10), sm+ keeps the original 3-up layout.
      */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StripStat
          icon={Building2}
          label="Properties"
          value={String(totals.propertyCount)}
        />
        <StripStat
          icon={AlertCircle}
          label="Needs action"
          value={String(totals.totalAttention)}
          destructive={totals.totalAttention > 0}
        />
        <StripStat
          icon={Star}
          label="Avg rating"
          value={formatRating(totals.overallAvgRating)}
          hint={`${totals.ratingSampleCount} eligible reviews`}
        />
      </div>

      <div className="flex flex-col gap-2">
        {entries.map((entry) => (
          <FleetRow key={entry.propertyId} entry={entry} />
        ))}
      </div>

      <FleetLoadMore
        nextCursor={data.nextCursor}
        isFetchingNextPage={isFetchingNextPage}
        onLoadMore={onLoadMore}
      />
    </Shell>
  )
}

function metricEvidenceTitle(evidence: FleetMetricEvidence): string {
  const completeness = Math.round(evidence.completeness * 100)
  const watermark = evidence.watermark?.toISOString() ?? 'No eligible reading'
  const sources =
    evidence.sourcePolicies.length > 0 ? evidence.sourcePolicies.join(', ') : 'None'
  return [
    `Definition ${evidence.definitionVersionId}`,
    `Completeness ${completeness}%`,
    `Watermark ${watermark}`,
    `Timezone ${evidence.timezone}`,
    `Corrections ${evidence.correctionCount}`,
    `Sources ${sources}`,
  ].join(' · ')
}

function EvidenceBadge({
  label,
  evidence,
}: Readonly<{ label: string; evidence: FleetMetricEvidence }>) {
  const freshnessLabel =
    evidence.freshness === 'insufficient_data' ? 'insufficient data' : evidence.freshness
  return (
    <Badge
      variant={evidence.freshness === 'fresh' ? 'secondary' : 'outline'}
      title={metricEvidenceTitle(evidence)}
    >
      {label} {freshnessLabel}
    </Badge>
  )
}

function FleetRow({ entry }: Readonly<{ entry: FleetEntry }>) {
  return (
    <Link
      to="/properties/$propertyId"
      params={{ propertyId: entry.propertyId }}
      // BQC-6.8 reflow: flex-wrap lets the attention badge drop below the
      // property stats instead of forcing horizontal overflow at 400% zoom.
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border p-4 transition-colors hover:bg-accent"
    >
      <div className="flex flex-col gap-1">
        <p className="font-semibold">{entry.name}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-sm tabular-nums">
            <Stars rating={entry.avgRating} />
            {formatRating(entry.avgRating)}
          </span>
          <span className="text-sm text-muted-foreground">
            {entry.reviewCount} reviews
          </span>
          <span className="flex items-center gap-0.5 text-xs tabular-nums text-muted-foreground">
            <TrendIndicator trend={entry.avgRatingComparison} />
            {formatRatingComparison(entry.avgRatingComparison)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <EvidenceBadge label="Reviews" evidence={entry.reviewEvidence} />
          {entry.scanEvidence ? (
            <>
              <span className="text-xs tabular-nums text-muted-foreground">
                {entry.scanCount} scans
              </span>
              <EvidenceBadge label="Scans" evidence={entry.scanEvidence} />
            </>
          ) : null}
          {entry.feedbackEvidence ? (
            <>
              <span className="text-xs tabular-nums text-muted-foreground">
                {entry.feedbackCount} responses
              </span>
              <EvidenceBadge label="Responses" evidence={entry.feedbackEvidence} />
            </>
          ) : null}
        </div>
      </div>
      <FleetAttentionBreakdown
        signals={entry.attentionSignals}
        totalAttention={entry.totalAttention}
      />
    </Link>
  )
}
