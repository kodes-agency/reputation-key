// Properties — every property you manage, as one table you can sort, filter
// and search (docs/plan/property-list-table.md).
//
// The list is a management surface first: it renders for a manager whose fleet
// or setup read is slow or denied, and a column whose read is unavailable is
// left out rather than shown as zeros. The figures, the summary strip and the
// order they allow are enrichments on top of the list.
//
// Presentational: the route owns the reads and the URL; this page receives the
// search and reports changes through `onSearchChange`.
import { Link } from '@tanstack/react-router'
import { Plus, SearchX } from 'lucide-react'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { GlossaryTerm } from '#/components/features/shared/glossary-term'
import { partitionWorkspaceProperties } from './property-workspace'
import type { PropertyListSearch, PropertyListSort } from './property-list-search-schema'
import { PropertyListRemoved } from './property-list-removed'
import { PropertyListSummaryStrip } from './property-list-summary'
import { PropertyListTable } from './property-list-table'
import { PropertyListToolbar } from './property-list-toolbar'
import {
  buildPropertyListRows,
  filterPropertyListRows,
  propertyListSearchPatch,
  resolvePropertyListView,
  sortPropertyListRows,
  summarizePropertyList,
  type DataState,
  type PropertyComparison,
  type PropertyListProperty,
  type PropertySetupProgress,
} from './property-list-view'

export type { PropertyComparison, PropertySetupProgress } from './property-list-view'

export interface PropertyListPageProps {
  properties: ReadonlyArray<PropertyListProperty>
  /** Keyed by property id; rows without an entry show no figures. */
  comparison?: ReadonlyMap<string, PropertyComparison>
  fleet: DataState
  /** Keyed by property id. */
  setup?: ReadonlyMap<string, PropertySetupProgress>
  setupState: DataState
  search: PropertyListSearch
  onSearchChange: (next: PropertyListSearch) => void
}

/**
 * Google import is the only way a property is created (decision 7), so a first
 * run opens it. A manager who cannot import is not sent to a flow that turns
 * them away, and a list whose properties were all removed is not a first run:
 * restoring one is the way back.
 */
function EmptyPropertyList({
  allRemoved,
  canImport,
}: Readonly<{ allRemoved: boolean; canImport: boolean }>) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-12 text-center">
      {allRemoved ? (
        <>
          <p className="text-muted-foreground">No active properties.</p>
          <p className="text-sm text-muted-foreground">
            Every property you have is currently removed. Restore one to start working
            again.
          </p>
        </>
      ) : (
        <>
          <p className="text-muted-foreground">No properties yet.</p>
          {canImport ? (
            // At 320 px the label is wider than the box, so it wraps, balanced.
            <Button asChild className="h-auto min-h-9 whitespace-normal text-balance">
              <Link to="/properties/import-google">
                Import your first property from Google
              </Link>
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Ask an account admin to import a property from Google or give you access to
              one.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function describe(workspace: ReadonlyArray<PropertyListProperty>): string | undefined {
  if (workspace.length === 0) return undefined
  const count = workspace.length === 1 ? '1 property' : `${workspace.length} properties`
  const paused = workspace.filter((property) => property.lifecycleState === 'suspended')
  return paused.length > 0 ? `${count} · ${paused.length} paused` : count
}

export function PropertyListPage({
  properties,
  comparison,
  fleet,
  setup,
  setupState,
  search,
  onSearchChange,
}: PropertyListPageProps) {
  const { can } = usePermissions()
  const { workspace, removed } = partitionWorkspaceProperties(properties)
  const view = resolvePropertyListView(search, { fleet, setup: setupState })
  const rows = buildPropertyListRows(workspace, comparison, setup)
  const visible = sortPropertyListRows(
    filterPropertyListRows(rows, view),
    view.appliedSort,
    view.appliedDir,
  )
  const update = (patch: Partial<PropertyListSearch>) =>
    onSearchChange(propertyListSearchPatch(search, patch))
  const onSort = (sort: PropertyListSort) =>
    update(
      sort === view.sort
        ? { sort, dir: view.dir === 'asc' ? 'desc' : 'asc' }
        : { sort, dir: undefined },
    )
  const several = workspace.length > 1

  // Radix unmounts the inactive tab, so each property name still renders once.
  const tab = removed.length > 0 && search.tab === 'removed' ? 'removed' : 'workspace'
  const workspaceContent = (
    <>
      {workspace.length === 0 ? (
        <EmptyPropertyList
          allRemoved={removed.length > 0}
          canImport={can('property.import_gbp_v2')}
        />
      ) : (
        <section aria-label="Property list" className="flex flex-col gap-4">
          {several ? (
            <>
              <PropertyListSummaryStrip
                summary={summarizePropertyList(rows)}
                fleet={fleet}
                setup={setupState}
                show={view.show}
                onShow={(show) => update({ show })}
              />
              <PropertyListToolbar
                view={view}
                fleet={fleet}
                setup={setupState}
                shown={visible.length}
                total={rows.length}
                onChange={update}
              />
            </>
          ) : null}
          {visible.length === 0 ? (
            <EmptyState icon={SearchX} title="No properties match">
              <Button
                variant="outline"
                onClick={() => update({ q: undefined, show: undefined })}
              >
                Clear search and filter
              </Button>
            </EmptyState>
          ) : (
            <PropertyListTable
              rows={visible}
              view={view}
              fleet={fleet}
              setup={setupState}
              onSort={onSort}
            />
          )}
          {fleet === 'ready' ? (
            <p className="text-sm text-muted-foreground">
              Ratings and review counts are all-time.{' '}
              <GlossaryTerm term="needs-attention">Needs attention</GlossaryTerm> counts
              work waiting on you.
            </p>
          ) : null}
        </section>
      )}
    </>
  )

  return (
    <PageShell tier="dashboard">
      <PageHeader
        title="Properties"
        description={describe(workspace)}
        actions={
          can('property.import_gbp_v2') ? (
            <Button asChild>
              <Link to="/properties/import-google">
                <Plus />
                Import from Google
              </Link>
            </Button>
          ) : undefined
        }
      />

      {removed.length > 0 ? (
        <Tabs
          value={tab}
          onValueChange={(value) =>
            update({ tab: value === 'removed' ? 'removed' : undefined })
          }
          className="gap-4"
        >
          <TabsList aria-label="Which properties">
            <TabsTrigger value="workspace" className="px-3">
              Workspace
              <span className="tabular-nums text-muted-foreground">
                {workspace.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="removed" className="px-3">
              Removed
              <span className="tabular-nums text-muted-foreground">{removed.length}</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="workspace">{workspaceContent}</TabsContent>
          <TabsContent value="removed">
            <PropertyListRemoved properties={removed} />
          </TabsContent>
        </Tabs>
      ) : (
        workspaceContent
      )}
    </PageShell>
  )
}
