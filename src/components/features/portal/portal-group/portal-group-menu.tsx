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
  if (menu.length === 0) return null
  const archive = menu.filter((entry) => entry.id === 'archive')
  const others = menu.filter((entry) => entry.id !== 'archive')
  return (
    <>
      <RowActionsMenu name={`group ${group.name}`}>
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
                  to="/properties/$propertyId/goals/new"
                  params={{ propertyId }}
                  search={{ subject: `portal_group:${group.id}` }}
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
