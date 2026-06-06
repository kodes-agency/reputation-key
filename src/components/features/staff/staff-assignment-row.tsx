/**
 * UserAssignmentRow — single user row in the staff assignment table.
 * Extracted from staff-assignment-list.tsx for max-lines compliance.
 */

import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
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
import { TableCell, TableRow } from '#/components/ui/table'
import { Pencil, Trash2 } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'

interface UserRowData {
  userId: string
  assignmentIds: string[]
  teamIds: Array<string | null>
  portalCount: number
}

export function resolveTeamDisplay(
  teamIds: Array<string | null>,
  teamLookup: Map<string, string>,
): string | null {
  const unique = [...new Set(teamIds.filter((t): t is string => t != null))]
  if (unique.length === 0) return null
  if (unique.length === 1) return teamLookup.get(unique[0]) ?? unique[0]
  return 'Multiple'
}

type Props = Readonly<{
  row: UserRowData
  displayName: string
  memberEmail: string | undefined
  teamDisplay: string | null
  onEdit: (userId: string) => void
  removeAction: Action<{ data: { assignmentId: string } }>
}>

export function UserAssignmentRow({
  row,
  displayName,
  memberEmail,
  teamDisplay,
  onEdit,
  removeAction,
}: Props) {
  const unassignDesc =
    row.portalCount > 1
      ? `This will remove all ${row.portalCount} portal assignments. They will no longer be assigned to this property.`
      : 'They will no longer be assigned to this property. You can reassign them later.'

  return (
    <TableRow>
      <TableCell className="font-medium">{displayName}</TableCell>
      <TableCell className="text-muted-foreground">{memberEmail ?? ''}</TableCell>
      <TableCell>
        {teamDisplay ? (
          <Badge variant="secondary">{teamDisplay}</Badge>
        ) : (
          <span className="text-muted-foreground">Direct</span>
        )}
      </TableCell>
      <TableCell>
        <Badge variant="outline">
          {row.portalCount} portal{row.portalCount !== 1 ? 's' : ''}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onEdit(row.userId)}>
            <Pencil /> Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
              >
                <Trash2 /> Unassign
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Unassign {displayName}?</AlertDialogTitle>
                <AlertDialogDescription>{unassignDesc}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={async () => {
                    for (const id of row.assignmentIds)
                      await removeAction({ data: { assignmentId: id } })
                  }}
                  disabled={removeAction.isPending}
                  className="bg-destructive text-white hover:bg-destructive/90"
                >
                  {removeAction.isPending ? 'Removing...' : 'Unassign All'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TableCell>
    </TableRow>
  )
}
