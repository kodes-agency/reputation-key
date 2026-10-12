// A group's page (board 13): its results over the window the reader chose, the
// portals in it, the goal it shares and what has happened to it. Presentational:
// the route owns the reads and the URL. The results, the goal and the history are
// side reads, so a slow or refused one never holds the rest back.
import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { PageHeader } from '#/components/layout/page-header'
import { trailCrumbs } from '#/components/layout/page-identity'
import { PageShell } from '#/components/layout/page-shell'
import { AddAction } from '#/components/ui/add-action'
import { Button } from '#/components/ui/button'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import type {
  PortalGroupHistoryEntry,
  PortalOverviewRow,
} from '#/contexts/portal/application/public-api'
import type { GoalProgress } from '#/contexts/reporting/application/public-api'
import type { PortalArchiveMutations } from '../portal-overview/portal-archive-dialog'
import {
  PortalOverviewResultsStrip,
  type PortalOverviewResultsControls,
} from '../portal-overview/portal-overview-results-strip'
import type { PortalManagerName } from '../portal-overview/portal-overview-view'
import {
  PortalGroupAddPortalsDialog,
  PortalGroupRenameDialog,
} from './portal-group-dialogs'
import { PortalGroupGoals } from './portal-group-goals'
import { PortalGroupHistory } from './portal-group-history'
import type { HistoryNames } from './portal-group-history-view'
import { groupPageControls } from './portal-group-menu-rules'
import { PortalGroupMenu } from './portal-group-menu'
import type { PortalGroupMutations, PortalGroupRef } from './portal-group-mutations'
import { PortalGroupPortals } from './portal-group-portals'
import type { ReadState } from './portal-group-read-state'

export type PortalGroupPageProps = PortalArchiveMutations &
  Pick<
    PortalGroupMutations,
    | 'renameMutation'
    | 'archiveGroupMutation'
    | 'movePortalMutation'
    | 'removePortalMutation'
  > &
  Readonly<{
    propertyId: string
    propertyName: string
    /** The property's time zone: dates in the history and the goal are its days. */
    timezone: string
    group: PortalGroupRef
    /** Every Portal of the property, with the group each is in now. */
    rows: readonly PortalOverviewRow[]
    members?: readonly PortalManagerName[]
    results?: PortalOverviewResultsControls
    goals: ReadState<readonly GoalProgress[]>
    history: ReadState<readonly PortalGroupHistoryEntry[]>
    names: HistoryNames
    /** People for "Set by": a name, or null where the directory cannot give one. */
    personName: (userId: string) => string | null
    now: Date
    onRetryGoals: () => void
    onRetryHistory: () => void
  }>

export function PortalGroupPage(props: PortalGroupPageProps) {
  const { propertyId, propertyName, group, rows, members = [], results } = props
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const [dialog, setDialog] = useState<'rename' | 'add' | null>(null)
  const canSetGoal = can('goal.create') && has('goal.use')
  const { canEdit } = groupPageControls({
    canRename: can('portal.update'),
    canArchive: can('portal.delete'),
    portalWriteEnabled: has('portal.write'),
    canSetGoal,
  })
  const inGroup = rows.filter((row) => row.group?.id === group.id)
  const meta = [
    'Group',
    `${inGroup.length === 1 ? '1 portal' : `${inGroup.length} portals`} at ${propertyName}`,
  ]

  return (
    <PageShell tier="dashboard">
      <PageHeader
        title={group.name}
        meta={meta}
        description="Shared results and goals for the portals in this group."
        breadcrumbs={trailCrumbs('portals', { propertyId, propertyName }, group.name)}
        actions={
          <>
            {canEdit ? (
              <>
                <Button variant="ghost" onClick={() => setDialog('rename')}>
                  <Pencil aria-hidden="true" />
                  Rename
                </Button>
                <AddAction variant="outline" onClick={() => setDialog('add')}>
                  Add portal
                </AddAction>
              </>
            ) : null}
            <PortalGroupMenu
              group={group}
              propertyId={propertyId}
              where="page"
              renameMutation={props.renameMutation}
              archiveGroupMutation={props.archiveGroupMutation}
            />
          </>
        }
      />
      {results ? (
        <PortalOverviewResultsStrip
          controls={results}
          propertyId={propertyId}
          groupId={group.id}
        />
      ) : null}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22.5rem]">
        <PortalGroupPortals
          group={group}
          propertyId={propertyId}
          propertyName={propertyName}
          rows={inGroup}
          members={members}
          results={results}
          canEdit={canEdit}
          onAdd={() => setDialog('add')}
          archiveMutation={props.archiveMutation}
          restoreMutation={props.restoreMutation}
          disableMutation={props.disableMutation}
          removePortalMutation={props.removePortalMutation}
        />
        <div className="flex flex-col gap-8">
          <PortalGroupGoals
            state={props.goals}
            propertyId={propertyId}
            groupId={group.id}
            context={{ setByName: props.personName, now: props.now }}
            canSetGoal={canSetGoal}
            onRetry={props.onRetryGoals}
          />
          <PortalGroupHistory
            state={props.history}
            names={props.names}
            frame={{ groupName: group.name, timezone: props.timezone, now: props.now }}
            onRetry={props.onRetryHistory}
          />
        </div>
      </div>
      <PortalGroupRenameDialog
        open={dialog === 'rename'}
        onOpenChange={(open) => setDialog(open ? 'rename' : null)}
        group={group}
        renameMutation={props.renameMutation}
      />
      <PortalGroupAddPortalsDialog
        open={dialog === 'add'}
        onOpenChange={(open) => setDialog(open ? 'add' : null)}
        group={group}
        rows={rows}
        movePortalMutation={props.movePortalMutation}
      />
    </PageShell>
  )
}
