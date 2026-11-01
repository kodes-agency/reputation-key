import { Pencil, UserRoundX } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'
import { StatusBadge } from '#/components/ui/status-badge'
import { formatDate } from '#/lib/format'
import { Button } from '#/components/ui/button'
import { ConfirmationDialog } from '#/components/ui/confirmation-dialog'
import { DataTableCell, DataTableRow } from '#/components/ui/data-table'
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

export function StaffParticipationRow({
  participation,
  canManageResponsibilities,
  archiveAction,
  onEditResponsibilities,
}: Props) {
  const active = participation.status === 'active' && participation.endedAt == null

  return (
    <DataTableRow>
      <DataTableCell className="col-start-1 row-start-1 min-w-0 whitespace-normal">
        <div className="min-w-40">
          <p className="font-medium">{participation.displayName}</p>
          <p className="text-xs text-muted-foreground">
            {formatDate(participation.startedAt)} –{' '}
            {participation.endedAt ? formatDate(participation.endedAt) : 'Present'}
          </p>
        </div>
      </DataTableCell>
      <DataTableCell className="col-start-2 row-start-1 justify-self-end">
        <StatusBadge
          tone={active ? 'positive' : 'neutral'}
          label={active ? 'Active' : 'Archived'}
        />
      </DataTableCell>
      <DataTableCell className="col-span-2 @3xl:text-right">
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
            <ConfirmationDialog
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  aria-label={`Archive staff participation for ${participation.displayName}`}
                >
                  <UserRoundX aria-hidden="true" />
                  <span className="hidden sm:inline">Archive</span>
                </Button>
              }
              title="Archive staff participation?"
              description={`${participation.displayName} will no longer be available for new Portal responsibilities. Their effective history is preserved.`}
              cancelLabel="Cancel"
              confirmLabel="Archive participation"
              pendingLabel="Archiving…"
              // The confirmation stays open and says a refusal (a stale
              // revision) itself.
              onConfirm={() =>
                archiveAction({
                  data: {
                    staffParticipationId: participation.id,
                    reason: 'Archived from property Staff page',
                    expectedRevision: participation.revision,
                  },
                })
              }
            />
          )}
        </div>
      </DataTableCell>
    </DataTableRow>
  )
}
