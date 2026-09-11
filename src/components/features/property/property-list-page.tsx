// Properties — the one place "all my properties" lives (redesign row 3).
//
// `/dashboard` used to be a second multi-property page: the same list again,
// with a 13-row × 3-badge provenance table, an org setup checklist pinned above
// the fold on every visit, and a time-range picker rendered outside the page
// shell. It was not in the sidebar, reachable only by redirect or URL.
//
// This page absorbs what was worth keeping — the comparison figures and the
// checklist while it is incomplete — and nothing else. The figures are an
// enrichment, not the spine: the list is a management surface (it shows removed
// properties, and it must render for a manager whose fleet read is denied or
// slow), so a row without metrics is a normal row, not a broken one.
import { Link } from '@tanstack/react-router'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { Plus, ChevronRight } from 'lucide-react'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { GlossaryTerm } from '#/components/features/shared/glossary-term'
import { partitionWorkspaceProperties } from './property-workspace'
import { SetupChecklistBanner } from '#/components/features/dashboard/setup-checklist-banner'
import type { SetupChecklist } from '#/contexts/reporting/application/public-api'

interface Property {
  id: string
  name: string
  slug: string
  timezone: string
  lifecycleState: string
}

/**
 * What the fleet read adds to a row. Identity and pulse, as on Overview: the
 * rating a manager recognises is all-time, the review count worth comparing is
 * recent (row 5).
 */
export type PropertyComparison = Readonly<{
  /** All-time, so the figure matches the Google profile and the Overview tile. */
  avgRating: number | null
  /** All-time review count. A bounded fleet window counts by when a review was
   *  recorded rather than when it was written, which disagrees with the
   *  per-property Overview on a freshly imported property — see the route. */
  reviewCount: number
  /** Distinct attention work, never the sum of overlapping signal counts. */
  totalAttention: number
}>

export interface PropertyListPageProps {
  properties: ReadonlyArray<Property>
  /** Keyed by property id. Absent keys render without figures, by design. */
  comparison?: ReadonlyMap<string, PropertyComparison>
  /** Omitted, or complete, renders no banner. */
  checklist?: SetupChecklist
}

function ComparisonFigures({
  comparison,
}: Readonly<{ comparison: PropertyComparison | undefined }>) {
  if (!comparison) return null

  return (
    <dl className="flex shrink-0 items-center gap-4 text-sm sm:gap-6">
      <div className="text-right">
        <dt className="text-xs text-muted-foreground">Rating</dt>
        <dd className="font-semibold tabular-nums">
          {comparison.avgRating === null ? (
            <span className="text-sm font-normal text-muted-foreground">No ratings</span>
          ) : (
            `${comparison.avgRating.toFixed(1)} ★`
          )}
        </dd>
      </div>
      <div className="hidden text-right sm:block">
        <dt className="text-xs text-muted-foreground">Reviews</dt>
        <dd className="font-semibold tabular-nums">
          {comparison.reviewCount.toLocaleString()}
        </dd>
      </div>
      <div className="text-right">
        <dt className="text-xs text-muted-foreground">Needs attention</dt>
        <dd
          className={
            comparison.totalAttention > 0
              ? 'font-semibold tabular-nums text-destructive'
              : 'font-semibold tabular-nums'
          }
        >
          {comparison.totalAttention}
        </dd>
      </div>
    </dl>
  )
}

function PropertyRow({
  property,
  removed,
  comparison,
}: Readonly<{
  property: Property
  removed: boolean
  comparison: PropertyComparison | undefined
}>) {
  return (
    <div className="flex items-stretch overflow-hidden rounded-lg border">
      <Link
        to="/properties/$propertyId"
        params={{ propertyId: property.id }}
        className="flex min-w-0 flex-1 items-center justify-between gap-4 p-4 outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate font-semibold">{property.name}</p>
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant="secondary">{property.slug}</Badge>
            {removed ? <Badge variant="outline">Removed</Badge> : null}
            <span className="truncate text-sm text-muted-foreground">
              {property.timezone}
            </span>
          </div>
        </div>
        {removed ? null : <ComparisonFigures comparison={comparison} />}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </div>
  )
}

export function PropertyListPage({
  properties,
  comparison,
  checklist,
}: PropertyListPageProps) {
  const { can } = usePermissions()
  const { workspace, removed } = partitionWorkspaceProperties(properties)
  const anyFigures = comparison !== undefined && comparison.size > 0

  return (
    <PageShell tier="dashboard">
      <PageHeader
        title="Properties"
        description="Every property you manage, side by side."
        breadcrumbs={[{ label: 'Properties' }]}
        actions={
          can('property.import_gbp_v2') ? (
            <Button asChild>
              <Link to="/properties/import-google">
                <Plus />
                Import Properties
              </Link>
            </Button>
          ) : undefined
        }
      />

      {checklist === undefined ? null : <SetupChecklistBanner checklist={checklist} />}

      {workspace.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
          <p className="text-muted-foreground">
            {removed.length === 0 ? 'No properties yet.' : 'No active properties.'}
          </p>
          <p className="text-sm text-muted-foreground">
            {removed.length === 0
              ? 'Add your first property to get started.'
              : 'Every property you have is currently removed. Restore one to start working again.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {workspace.map((property) => (
            <PropertyRow
              key={property.id}
              property={property}
              removed={false}
              comparison={comparison?.get(property.id)}
            />
          ))}
        </div>
      )}

      {anyFigures ? (
        <p className="text-sm text-muted-foreground">
          Ratings and review counts are all-time.{' '}
          <GlossaryTerm term="needs-attention">Needs attention</GlossaryTerm> counts work
          waiting on you.
        </p>
      ) : null}

      {removed.length > 0 ? (
        <details className="mt-8 rounded-lg border border-dashed">
          <summary className="cursor-pointer list-none p-4 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
            Removed properties ({removed.length}) — open a property to restore it
          </summary>
          <div className="flex flex-col gap-2 border-t p-4">
            {removed.map((property) => (
              <PropertyRow
                key={property.id}
                property={property}
                removed
                comparison={undefined}
              />
            ))}
          </div>
        </details>
      ) : null}
    </PageShell>
  )
}
