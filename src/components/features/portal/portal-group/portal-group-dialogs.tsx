// The group dialogs (boards 12 and 13): New group, Rename and Add portals. Each
// is controlled by whoever opens it, because a dialog mounted inside a menu item
// closes with the menu. The body unmounts on close, so a reopened dialog starts
// clean.
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'
import { PortalGroupAddForm } from './portal-group-add-form'
import { PortalGroupCreateForm } from './portal-group-create-form'
import type { PortalGroupMutations, PortalGroupRef } from './portal-group-mutations'
import { PortalGroupRenameForm } from './portal-group-rename-form'

type OpenProps = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
}>

const CONTENT =
  'grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-xl'

export function PortalGroupDialog({
  open,
  onOpenChange,
  propertyId,
  rows,
  createMutation,
}: OpenProps &
  Readonly<{
    propertyId: string
    rows: readonly PortalOverviewRow[]
    createMutation: PortalGroupMutations['createMutation']
  }>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={CONTENT}>
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
          <DialogDescription>
            Group portals to see their results together and to set shared goals. Guests
            never see groups.
          </DialogDescription>
        </DialogHeader>
        <PortalGroupCreateForm
          propertyId={propertyId}
          rows={rows}
          mutation={createMutation}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

export function PortalGroupRenameDialog({
  open,
  onOpenChange,
  group,
  renameMutation,
}: OpenProps &
  Readonly<{
    group: PortalGroupRef
    renameMutation: PortalGroupMutations['renameMutation']
  }>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename group</DialogTitle>
          <DialogDescription>
            Only your team sees the name. Results and goals stay with the group.
          </DialogDescription>
        </DialogHeader>
        <PortalGroupRenameForm
          group={group}
          mutation={renameMutation}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

export function PortalGroupAddPortalsDialog({
  open,
  onOpenChange,
  group,
  rows,
  movePortalMutation,
}: OpenProps &
  Readonly<{
    group: PortalGroupRef
    rows: readonly PortalOverviewRow[]
    movePortalMutation: PortalGroupMutations['movePortalMutation']
  }>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={CONTENT}>
        <DialogHeader>
          <DialogTitle>Add portals to {group.name}</DialogTitle>
          <DialogDescription>
            A portal can be in one group at a time. One that is in another group moves
            here, and its earlier results stay with that group.
          </DialogDescription>
        </DialogHeader>
        <PortalGroupAddForm
          groupId={group.id}
          rows={rows}
          mutation={movePortalMutation}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
