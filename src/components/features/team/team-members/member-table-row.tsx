import { Button } from '#/components/ui/button'
import { TableCell, TableRow } from '#/components/ui/table'
import type { AssignmentInTeam } from '#/components/features/team/shared/types'

type Props = Readonly<{
  assignment: AssignmentInTeam
  memberName: string
  memberEmail: string
  isLead: boolean
  onRemove: () => void
  isRemoving: boolean
}>

export function MemberTableRow({
  assignment,
  memberName,
  memberEmail,
  isLead,
  onRemove,
  isRemoving,
}: Props) {
  return (
    <TableRow key={assignment.id}>
      <TableCell className="font-medium">
        {memberName}
        {isLead && (
          <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-link">
            Lead
          </span>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">{memberEmail ?? '—'}</TableCell>
      <TableCell className="text-right">
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          disabled={isRemoving}
          className="text-muted-foreground hover:text-destructive"
        >
          Remove
        </Button>
      </TableCell>
    </TableRow>
  )
}
