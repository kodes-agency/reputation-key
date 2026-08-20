import { Table, TableBody, TableHead, TableHeader, TableRow } from '#/components/ui/table'
import { MemberTableRow } from './member-table-row'
import type { TeamMembershipView } from '#/components/features/team/shared/types'

type Props = Readonly<{
  memberships: ReadonlyArray<TeamMembershipView>
  canRemove: boolean
  onRemove?: (staffParticipationId: string) => void
  isRemoving: boolean
}>

export function MemberTable({ memberships, canRemove, onRemove, isRemoving }: Props) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Effective period</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {memberships.map((membership) => (
            <MemberTableRow
              key={membership.id}
              membership={membership}
              canRemove={canRemove}
              onRemove={
                onRemove ? () => onRemove(membership.staffParticipationId) : undefined
              }
              isRemoving={isRemoving}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
