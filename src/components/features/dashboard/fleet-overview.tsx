// Fleet overview — cross-property landing for orgs with 2+ properties.
// Renders inside the `dashboard` tier. Rows are attention-sorted (most-needing first);
// each row deep-links into that property's deep-dive.
import type { ReactNode } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { Building2, AlertCircle, Star, Plus } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { LoadingState, ErrorState } from '#/components/layout/page-states'
import {
  Stars,
  TrendIndicator,
  formatTrend,
} from '#/components/features/property/property-dashboard-helpers'
import type {
  FleetEntry,
  FleetOverviewData,
} from '#/contexts/dashboard/application/public-api'

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

export function FleetOverviewLoading() {
  return (
    <Shell>
      <LoadingState label="Loading fleet overview…" />
    </Shell>
  )
}

export function FleetOverviewError({ message }: Readonly<{ message?: string }>) {
  const router = useRouter()
  return (
    <Shell>
      <ErrorState message={message} onRetry={() => router.invalidate()} />
    </Shell>
  )
}

export function FleetOverviewEmpty() {
  return (
    <Shell>
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <h2 className="text-lg font-medium">No properties yet</h2>
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          Create your first property to start managing reviews, staff performance, and
          reputation.
        </p>
        <Button asChild>
          <Link to="/properties/import">
            <Plus />
            Create Property
          </Link>
        </Button>
      </div>
    </Shell>
  )
}

export interface FleetOverviewProps {
  readonly data: FleetOverviewData
}

export function FleetOverview({ data }: FleetOverviewProps) {
  const { entries, totals } = data
  return (
    <Shell>
      <div className="grid grid-cols-3 gap-3">
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
        />
      </div>

      <div className="flex flex-col gap-2">
        {entries.map((entry) => (
          <FleetRow key={entry.propertyId} entry={entry} />
        ))}
      </div>
    </Shell>
  )
}

function StripStat({
  icon: Icon,
  label,
  value,
  destructive,
}: Readonly<{
  icon: typeof Building2
  label: string
  value: string
  destructive?: boolean
}>) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p
        className={`mt-2 text-2xl font-semibold tabular-nums ${destructive ? 'text-destructive' : ''}`}
      >
        {value}
      </p>
    </div>
  )
}

function FleetRow({ entry }: Readonly<{ entry: FleetEntry }>) {
  return (
    <Link
      to="/properties/$propertyId"
      params={{ propertyId: entry.propertyId }}
      className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent"
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
            <TrendIndicator trend={entry.avgRatingTrend} />
            {formatTrend(entry.avgRatingTrend)}
          </span>
        </div>
      </div>
      {entry.totalAttention > 0 ? (
        <Badge variant="destructive">{entry.totalAttention} needing action</Badge>
      ) : (
        <Badge variant="secondary">All clear</Badge>
      )}
    </Link>
  )
}
