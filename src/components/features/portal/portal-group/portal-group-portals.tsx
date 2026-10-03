// "Portals in this group" on a group's page (board 13): the same rows as the
// overview, with no group heads, ordered by qualified scans where the results
// are shown. Under the table: a quiet "Add portal", the one-group rule, and what
// the group's results count.
import { useState } from 'react'
import { Globe, Info, Plus } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { DropdownMenuItem } from '#/components/ui/dropdown-menu'
import { EmptyState } from '#/components/ui/empty-state'
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'
import type { PortalArchiveMutations } from '../portal-overview/portal-archive-dialog'
import type { PortalOverviewResultsControls } from '../portal-overview/portal-overview-results-strip'
import type { PortalOverviewResultsState } from '../portal-overview/portal-overview-results'
import { PortalOverviewTable } from '../portal-overview/portal-overview-table'
import {
  buildPortalOverview,
  type PortalManagerName,
} from '../portal-overview/portal-overview-view'
import type { PortalGroupMutations, PortalGroupRef } from './portal-group-mutations'
import {
  PortalGroupRemovePortalDialog,
  type PortalChosenForRemoval,
} from './portal-group-remove-portal-dialog'

type Props = PortalArchiveMutations &
  Readonly<{
    group: PortalGroupRef
    propertyId: string
    propertyName: string
    /** The Portals in this group today. */
    rows: readonly PortalOverviewRow[]
    members: readonly PortalManagerName[]
    results: PortalOverviewResultsControls | undefined
    /** May add and take out Portals: a Portal update, with portal writes on. */
    canEdit: boolean
    onAdd: () => void
    removePortalMutation: PortalGroupMutations['removePortalMutation']
  }>

/** What the group's results count, in the words of the board. */
function basisLine(state: PortalOverviewResultsState, groupId: string): string | null {
  if (state.status !== 'ready') return null
  const strip = state.index.groupStrip(groupId)
  if (!strip) return null
  return `Group results count each portal from the day it joined. Averages need ${strip.averageMinSample} private ratings.`
}

export function PortalGroupPortals({
  group,
  propertyId,
  propertyName,
  rows,
  members,
  results,
  canEdit,
  onAdd,
  archiveMutation,
  restoreMutation,
  disableMutation,
  removePortalMutation,
}: Props) {
  // The menu item only chooses; the dialog lives out here because a dialog
  // inside a menu unmounts with it.
  const [removing, setRemoving] = useState<PortalChosenForRemoval | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const resultsState: PortalOverviewResultsState = results?.state ?? { status: 'off' }
  const byScans = resultsState.status === 'ready'
  const overview = buildPortalOverview(
    rows,
    byScans ? { groupBy: 'none', sort: 'scans' } : { groupBy: 'none' },
    members,
    Math.max(rows.length, 1),
    byScans ? resultsState.index.sortFigures : undefined,
  )
  const basis = basisLine(resultsState, group.id)
  return (
    <section aria-labelledby="group-portals-heading" className="flex flex-col gap-3">
      <h2 id="group-portals-heading" className="text-base font-semibold">
        Portals in this group
      </h2>
      {rows.length === 0 ? (
        <EmptyState size="compact" icon={Globe} title="No portals in this group yet" />
      ) : (
        <PortalOverviewTable
          sections={overview.sections}
          propertyId={propertyId}
          propertyName={propertyName}
          archiveMutation={archiveMutation}
          restoreMutation={restoreMutation}
          disableMutation={disableMutation}
          results={resultsState}
          busy={results?.busy}
          scansOrder={byScans ? 'desc' : undefined}
          showGroup={false}
          density="compact"
          rowMenuExtra={
            canEdit
              ? (item) => (
                  <DropdownMenuItem
                    disabled={removePortalMutation.isPending}
                    onSelect={() => {
                      setRemoving({ portalId: item.row.portalId, name: item.row.name })
                      setRemoveOpen(true)
                    }}
                  >
                    Remove from group
                  </DropdownMenuItem>
                )
              : undefined
          }
        />
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {canEdit ? (
          <Button variant="ghost" size="sm" onClick={onAdd}>
            <Plus aria-hidden="true" />
            Add portal
          </Button>
        ) : null}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="size-3.5 shrink-0" aria-hidden="true" />A portal can be in one
          group at a time.
        </p>
      </div>
      {basis ? <p className="text-xs text-muted-foreground">{basis}</p> : null}
      <PortalGroupRemovePortalDialog
        portal={removing}
        groupName={group.name}
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        onConfirm={(portalId) =>
          removePortalMutation({ data: { portalGroupId: group.id, portalId } })
        }
      />
    </section>
  )
}
