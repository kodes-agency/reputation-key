import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { PortalGroupMembers } from './portal-group-members'
import { PortalGroupRenameForm } from './portal-group-rename-form'
import type {
  PortalGroupMutations,
  PortalGroupView,
  PortalOption,
} from './portal-group-types'

type Props = Readonly<{
  group: PortalGroupView
  portalById: ReadonlyMap<string, PortalOption>
  eligiblePortals: readonly PortalOption[]
  canUpdate: boolean
  canDelete: boolean
  updateMutation: PortalGroupMutations['updateMutation']
  deleteMutation: PortalGroupMutations['deleteMutation']
  addPortalMutation: PortalGroupMutations['addPortalMutation']
  removePortalMutation: PortalGroupMutations['removePortalMutation']
}>

export function PortalGroupRow({
  group,
  portalById,
  eligiblePortals,
  canUpdate,
  canDelete,
  updateMutation,
  deleteMutation,
  addPortalMutation,
  removePortalMutation,
}: Props) {
  const [editing, setEditing] = useState(false)

  return (
    <article className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {editing ? (
          <PortalGroupRenameForm
            groupId={group.id}
            initialName={group.name}
            mutation={updateMutation}
            onSaved={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate font-semibold">{group.name}</h3>
            <Badge variant="outline">
              {group.portalIds.length}{' '}
              {group.portalIds.length === 1 ? 'portal' : 'portals'}
            </Badge>
          </div>
        )}

        {!editing && (canUpdate || canDelete) && (
          <div className="flex flex-wrap gap-2">
            {canUpdate && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(true)
                }}
              >
                <Pencil data-icon="inline-start" /> Rename
              </Button>
            )}
            {canDelete && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 data-icon="inline-start" /> Archive group
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Archive {group.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The group will no longer be available for new selections. Its
                      historical associations are retained.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        void deleteMutation({
                          data: { portalGroupId: group.id },
                        }).catch(() => undefined)
                      }}
                    >
                      {deleteMutation.isPending ? 'Archiving…' : 'Archive group'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}
      </div>

      <PortalGroupMembers
        group={group}
        portalById={portalById}
        eligiblePortals={eligiblePortals}
        canUpdate={canUpdate}
        addPortalMutation={addPortalMutation}
        removePortalMutation={removePortalMutation}
      />
    </article>
  )
}
