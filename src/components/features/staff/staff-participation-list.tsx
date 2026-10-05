import { UserRoundPlus } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'
import { EmptyState } from '#/components/ui/empty-state'
import {
  DataTable,
  DataTableBody,
  DataTableHead,
  DataTableHeader,
} from '#/components/ui/data-table'
import { StaffParticipationRow } from './staff-participation-row'
import type {
  ArchiveStaffParticipationMutationInput,
  StaffParticipationView,
} from '#/components/features/staff/types'

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
      <EmptyState
        icon={UserRoundPlus}
        title="No staff participate at this property yet"
        description="Add a participant to connect their work with this property's Portals."
      />
    )
  }

  return (
    <DataTable label="Staff participation" from="3xl">
      <DataTableHeader>
        <DataTableHead>Staff member</DataTableHead>
        <DataTableHead>Status</DataTableHead>
        <DataTableHead actions />
      </DataTableHeader>
      <DataTableBody>
        {participations.map((participation) => (
          <StaffParticipationRow
            key={participation.id}
            participation={participation}
            canManageResponsibilities={canManageResponsibilities}
            archiveAction={archiveAction}
            onEditResponsibilities={() => onEditResponsibilities(participation.id)}
          />
        ))}
      </DataTableBody>
    </DataTable>
  )
}
