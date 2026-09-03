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
import { Button } from '#/components/ui/button'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { LoadingState, ErrorState } from '#/components/layout/page-states'
import type { FleetOverviewData } from '#/contexts/dashboard/application/public-api'
import { FleetRow, formatRating } from './fleet-row'

/** Shared shell + header so every fleet state (loading/error/empty/data) is consistent. */
function Shell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <PageShell tier="dashboard">
      <PageHeader title="Dashboard" description="Overview across all properties" />
      {children}
    </PageShell>
  )
}

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

export function FleetOverviewEmpty({ setup }: Readonly<{ setup?: ReactNode }>) {
  const { can } = usePermissions()
  return (
    <Shell>
      {setup}
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
  readonly setup?: ReactNode
  /**
   * Absent in the story/fixture cases that render a single settled page. The
   * control only appears when the projection actually handed back a cursor.
   */
  readonly isFetchingNextPage?: boolean
  readonly onLoadMore?: () => void
}

export function FleetOverview({
  data,
  setup,
  isFetchingNextPage = false,
  onLoadMore,
}: FleetOverviewProps) {
  const { entries, totals } = data
  return (
    <Shell>
      {setup}
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
          label="Needs attention"
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
