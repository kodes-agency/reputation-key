import { Pencil, UserRoundX } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
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
import type {
  ArchiveStaffParticipationMutationInput,
  StaffParticipationView,
} from '#/components/features/team/shared/types'

type Props = Readonly<{
  participation: StaffParticipationView
  canManageResponsibilities: boolean
  archiveAction: Action<{ data: ArchiveStaffParticipationMutationInput }>
  onEditResponsibilities: () => void
}>

export function StaffParticipationRow({
  participation,
  canManageResponsibilities,
  archiveAction,
  onEditResponsibilities,
}: Props) {
  const active = participation.status === 'active' && participation.endedAt == null

  return (
    <TableRow>
      <TableCell>
        <div className="min-w-40">
          <p className="font-medium">{participation.displayName}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(participation.startedAt).toLocaleDateString()} –{' '}
            {participation.endedAt
              ? new Date(participation.endedAt).toLocaleDateString()
              : 'Present'}
          </p>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={active ? 'secondary' : 'outline'}>
          {active ? 'Active' : 'Archived'}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          {active && canManageResponsibilities && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onEditResponsibilities}
              aria-label={`Edit portal responsibilities for ${participation.displayName}`}
            >
              <Pencil aria-hidden="true" />
              <span className="hidden sm:inline">Responsibilities</span>
            </Button>
          )}
          {active && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Archive staff participation for ${participation.displayName}`}
                >
                  <UserRoundX aria-hidden="true" />
                  <span className="hidden sm:inline">Archive</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive staff participation?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {participation.displayName} will no longer be available for new team
                    or portal responsibilities. Their effective history is preserved.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={archiveAction.isPending}
                    onClick={() =>
                      archiveAction({
                        data: {
                          staffParticipationId: participation.id,
                          reason: 'Archived from property People page',
                        },
                      })
                    }
                  >
                    {archiveAction.isPending ? 'Archiving…' : 'Archive participation'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}
