// A group's "Actions" menu: on a group head in the overview and on the group's
// page. Rename and archive open controlled dialogs, because a dialog mounted
// inside a menu item closes with the menu.
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Ellipsis } from 'lucide-react'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { PortalGroupArchiveDialog } from './portal-group-archive-dialog'
import { PortalGroupRenameDialog } from './portal-group-dialogs'
import { groupMenu } from './portal-group-menu-rules'
import type { PortalGroupMutations, PortalGroupRef } from './portal-group-mutations'

// The global `a` colour is unlayered, so a link used as a menu item pins its ink.
const ITEM = 'min-h-11 text-foreground! md:min-h-8'

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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 text-muted-foreground md:size-8"
            aria-label={`Actions for group ${group.name}`}
          >
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {others.map((entry) => {
            if (entry.id === 'open') {
              return (
                <DropdownMenuItem key={entry.id} asChild className={ITEM}>
                  <Link
                    to="/properties/$propertyId/portals/groups/$groupId"
                    params={{ propertyId, groupId: group.id }}
                  >
                    {entry.label}
                  </Link>
                </DropdownMenuItem>
              )
            }
            if (entry.id === 'goal') {
              return (
                <DropdownMenuItem key={entry.id} asChild className={ITEM}>
                  <Link
                    to="/properties/$propertyId/goals/new"
                    params={{ propertyId }}
                    search={{ subject: `portal_group:${group.id}` }}
                  >
                    {entry.label}
                  </Link>
                </DropdownMenuItem>
              )
            }
            return (
              <DropdownMenuItem
                key={entry.id}
                className={ITEM}
                onSelect={() => setDialog('rename')}
              >
                {entry.label}
              </DropdownMenuItem>
            )
          })}
          {others.length > 0 && archive.length > 0 ? <DropdownMenuSeparator /> : null}
          {archive.map((entry) => (
            <DropdownMenuItem
              key={entry.id}
              variant="destructive"
              className="min-h-11 text-destructive! md:min-h-8"
              onSelect={() => setDialog('archive')}
            >
              {entry.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
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
