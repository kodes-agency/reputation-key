import { UserRoundPlus } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { EmptyState } from '#/components/ui/empty-state'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '#/components/ui/table'
import { StaffParticipationRow } from './staff-participation-row'
import type {
  ArchiveStaffParticipationMutationInput,
  StaffParticipationView,
} from '#/components/features/team/shared/types'

type Props = Readonly<{
  participations: ReadonlyArray<StaffParticipationView>
  canManageResponsibilities: boolean
  archiveAction: Action<{ data: ArchiveStaffParticipationMutationInput }>
  onEditResponsibilities: (staffParticipationId: string) => void
}>

export function StaffParticipationList({
  participations,
  canManageResponsibilities,
  archiveAction,
  onEditResponsibilities,
}: Props) {
  if (participations.length === 0) {
    return (
      <EmptyState icon={UserRoundPlus} title="No staff participate at this property yet">
        <p className="max-w-md text-sm text-muted-foreground">
          Add an organization member to make them eligible for team membership and portal
          responsibilities at this property.
        </p>
      </EmptyState>
    )
  }

  return (
    <div className="space-y-3">
      <FormErrorBanner error={archiveAction.error} />
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Staff member</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {participations.map((participation) => (
              <StaffParticipationRow
                key={participation.id}
                participation={participation}
                canManageResponsibilities={canManageResponsibilities}
                archiveAction={archiveAction}
                onEditResponsibilities={() => onEditResponsibilities(participation.id)}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
