import { Table, TableBody, TableHead, TableHeader, TableRow } from '#/components/ui/table'
import { MemberTableRow } from './member-table-row'
import type { AssignmentInTeam } from '#/components/features/team/shared/types'

type Props = Readonly<{
  assignments: ReadonlyArray<AssignmentInTeam>
  memberLookup: Map<string, { name: string; email: string }>
  teamLeadId: string | null | undefined
  onRemove: (assignmentId: string) => void
  isRemoving: boolean
}>

export function MemberTable({
  assignments,
  memberLookup,
  teamLeadId,
  onRemove,
  isRemoving,
}: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {assignments.map((a) => {
          const member = memberLookup.get(a.userId)
          const isLead = teamLeadId != null && a.userId === teamLeadId
          return (
            <MemberTableRow
              key={a.id}
              assignment={a}
              memberName={member?.name ?? a.userId}
              memberEmail={member?.email ?? '—'}
              isLead={isLead}
              onRemove={() => onRemove(a.id)}
              isRemoving={isRemoving}
            />
          )
        })}
      </TableBody>
    </Table>
  )
}
