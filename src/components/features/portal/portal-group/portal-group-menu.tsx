import { Button } from '#/components/ui/button'
import { useStaffAccounts } from '#/components/features/staff/accounts/staff-accounts-context'
// A group's "Actions" menu: on a group head in the overview and on the group's
// page. Rename and archive open controlled dialogs, because a dialog mounted
// inside a menu item closes with the menu.
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { usePermissions } from '#/shared/hooks/usePermissions'
import {
  RowActionsItem,
  RowActionsMenu,
  RowActionsSeparator,
} from '#/components/ui/row-actions-menu'
import { PortalGroupArchiveDialog } from './portal-group-archive-dialog'
import { PortalGroupRenameDialog } from './portal-group-dialogs'
import { groupMenu } from './portal-group-menu-rules'
import type { PortalGroupMutations, PortalGroupRef } from './portal-group-mutations'

type Props = Readonly<{
  group: PortalGroupRef
  propertyId: string
  where: 'overview' | 'page'
  renameMutation: PortalGroupMutations['renameMutation']
  archiveGroupMutation: PortalGroupMutations['archiveGroupMutation']
}>

export function PortalGroupMenu({
  group,
  propertyId,
  where,
  renameMutation,
  archiveGroupMutation,
}: Props) {
  const staff = useStaffAccounts()
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const [dialog, setDialog] = useState<'rename' | 'archive' | null>(null)
  const menu = groupMenu(
    {
      canRename: can('portal.update'),
      canArchive: can('portal.delete'),
      portalWriteEnabled: has('portal.write'),
      canSetGoal: can('goal.create') && has('goal.use'),
    },
    where,
  )
  if (menu.length === 0 && !staff?.canInvite) return null
  const archive = menu.filter((entry) => entry.id === 'archive')
  const others = menu.filter((entry) => entry.id !== 'archive')
  return (
    <>
      {menu.length + (staff?.canInvite ? 1 : 0) === 1 ? (
        staff?.canInvite ? (
          <Button
            variant="outline"
            aria-label={`Add staff to ${group.name}`}
            onClick={() => staff.openAdd(group.id)}
          >
            Add staff
          </Button>
        ) : (
          <SingleGroupAction
            entry={menu[0]!}
            propertyId={propertyId}
            groupId={group.id}
            groupName={group.name}
            onSelect={(id) => setDialog(id === 'archive' ? 'archive' : 'rename')}
          />
        )
      ) : (
        <RowActionsMenu name={`group ${group.name}`}>
          {staff?.canInvite ? (
            <RowActionsItem opensDialog onSelect={() => staff.openAdd(group.id)}>
              Add staff
            </RowActionsItem>
          ) : null}
          {others.map((entry) => {
            if (entry.id === 'open') {
              return (
                <RowActionsItem key={entry.id} asChild>
                  <Link
                    to="/properties/$propertyId/portals/groups/$groupId"
                    params={{ propertyId, groupId: group.id }}
                  >
                    {entry.label}
                  </Link>
                </RowActionsItem>
              )
            }
            if (entry.id === 'goal') {
              return (
                <RowActionsItem key={entry.id} asChild>
                  <Link
                    to="/properties/$propertyId/goals/portals"
                    params={{ propertyId }}
                    search={{ add: 'group', subject: `portal_group:${group.id}` }}
                  >
                    {entry.label}
                  </Link>
                </RowActionsItem>
              )
            }
            return (
              <RowActionsItem
                key={entry.id}
                opensDialog
                onSelect={() => setDialog('rename')}
              >
                {entry.label}
              </RowActionsItem>
            )
          })}
          {others.length > 0 && archive.length > 0 ? <RowActionsSeparator /> : null}
          {archive.map((entry) => (
            <RowActionsItem
              key={entry.id}
              destructive={entry.destructive}
              opensDialog
              onSelect={() => setDialog('archive')}
            >
              {entry.label}
            </RowActionsItem>
          ))}
        </RowActionsMenu>
      )}
      <PortalGroupRenameDialog
        open={dialog === 'rename'}
        onOpenChange={(open) => setDialog(open ? 'rename' : null)}
        group={group}
        renameMutation={renameMutation}
      />
      <PortalGroupArchiveDialog
        open={dialog === 'archive'}
        onOpenChange={(open) => setDialog(open ? 'archive' : null)}
        group={group}
        archiveGroupMutation={archiveGroupMutation}
      />
    </>
  )
}

function SingleGroupAction({
  entry,
  propertyId,
  groupId,
  groupName,
  onSelect,
}: Readonly<{
  entry: ReturnType<typeof groupMenu>[number]
  propertyId: string
  groupId: string
  groupName: string
  onSelect: (id: string) => void
}>) {
  // The overview repeats this on every group, so the name says which one.
  const label = `${entry.label}: ${groupName}`
  if (entry.id === 'open')
    return (
      <Button variant="outline" asChild>
        <Link
          to="/properties/$propertyId/portals/groups/$groupId"
          params={{ propertyId, groupId }}
          aria-label={label}
        >
          {entry.label}
        </Link>
      </Button>
    )
  if (entry.id === 'goal')
    return (
      <Button variant="outline" asChild>
        <Link
          to="/properties/$propertyId/goals/portals"
          params={{ propertyId }}
          search={{ add: 'group', subject: `portal_group:${groupId}` }}
          aria-label={label}
        >
          {entry.label}
        </Link>
      </Button>
    )
  return (
    <Button
      variant={entry.destructive ? 'destructive' : 'outline'}
      aria-label={label}
      onClick={() => onSelect(entry.id)}
    >
      {entry.label}
    </Button>
  )
}
