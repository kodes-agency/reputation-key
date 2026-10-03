import { Pencil, UserRoundX } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'
import { StatusBadge } from '#/components/ui/status-badge'
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
} from '#/components/features/staff/types'

type Props = Readonly<{
  participation: StaffParticipationView
  canManageResponsibilities: boolean
  archiveAction: Action<{ data: ArchiveStaffParticipationMutationInput }>
  onEditResponsibilities: () => void
}>

// Pinned, because the page is server-rendered in the container's zone and
// hydrated in the viewer's: the runtime's own zone and locale printed two
// different days, which React rejects as a hydration mismatch (#418).
const participationDateFormat = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})

/**
 * A participation boundary as a calendar date, or nothing when it is not a real
 * instant: `format` throws on an Invalid Date, and one bad row must not take the
 * People page down (the guard `formatReviewedAt` uses for the same reason).
 */
function formatParticipationDate(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? participationDateFormat.format(date) : null
}

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
            {formatParticipationDate(participation.startedAt)} –{' '}
            {participation.endedAt
              ? formatParticipationDate(participation.endedAt)
              : 'Present'}
          </p>
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge
          tone={active ? 'positive' : 'neutral'}
          label={active ? 'Active' : 'Archived'}
        />
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
                  className="text-muted-foreground hover:text-negative"
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
                    {participation.displayName} will no longer be available for new Portal
                    responsibilities. Their effective history is preserved.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={archiveAction.isPending}
                    // The list's banner shows a refusal from the Action's error;
                    // settling here keeps it from escaping as an unhandled one.
                    onClick={() =>
                      void archiveAction({
                        data: {
                          staffParticipationId: participation.id,
                          reason: 'Archived from property People page',
                          expectedRevision: participation.revision,
                        },
                      }).catch(() => undefined)
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
