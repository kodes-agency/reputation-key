// One fleet row: a property's rating, volume, per-metric evidence badges and
// attention breakdown, deep-linking into that property's dashboard. Split out of
// fleet-overview.tsx, which owns the page states and the totals strip.
import { Link } from '@tanstack/react-router'
import { Badge } from '#/components/ui/badge'
import {
  Stars,
  TrendIndicator,
} from '#/components/features/property/property-dashboard-helpers'
import type {
  FleetEntry,
  FleetMetricEvidence,
} from '#/contexts/dashboard/application/public-api'
import { FleetAttentionBreakdown } from './fleet-attention-breakdown'
import { AvailabilityLine } from './availability-line'

export const formatRating = (rating: number | null): string =>
  rating !== null && rating > 0 ? rating.toFixed(1) : '—'

export const formatRatingComparison = (comparison: number | null): string =>
  comparison === null ? '—' : `${comparison > 0 ? '+' : ''}${comparison.toFixed(1)} stars`

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
  const state = evidence.freshness === 'insufficient_data' ? 'insufficient_data' : 'ready'
  return (
    <Badge
      variant={evidence.freshness === 'fresh' ? 'secondary' : 'outline'}
      title={metricEvidenceTitle(evidence)}
    >
      {label}{' '}
      <AvailabilityLine
        state={state}
        dataThrough={evidence.watermark}
        reason={null}
        timeZone={evidence.timezone}
      />
    </Badge>
  )
}

export function FleetRow({ entry }: Readonly<{ entry: FleetEntry }>) {
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
