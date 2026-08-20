import { Crown } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { TableCell, TableRow } from '#/components/ui/table'
import type { TeamMembershipView } from '#/components/features/team/shared/types'

type Props = Readonly<{
  membership: TeamMembershipView
  canRemove: boolean
  onRemove?: () => void
  isRemoving: boolean
}>

export function MemberTableRow({ membership, canRemove, onRemove, isRemoving }: Props) {
  return (
    <TableRow>
      <TableCell className="font-medium">
        <span className="flex min-w-40 items-center gap-2">
          {membership.displayName}
          {membership.role === 'lead' && (
            <Badge variant="secondary">
              <Crown className="size-3" aria-hidden="true" />
              Lead
            </Badge>
          )}
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {new Date(membership.effectiveFrom).toLocaleDateString()} –{' '}
        {membership.effectiveTo
          ? new Date(membership.effectiveTo).toLocaleDateString()
          : 'Present'}
      </TableCell>
      <TableCell className="text-right">
        {canRemove &&
        onRemove &&
        membership.effectiveTo == null &&
        membership.role !== 'lead' ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            disabled={isRemoving}
            className="text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${membership.displayName} from team`}
          >
            {isRemoving ? 'Removing…' : 'Remove'}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            {membership.effectiveTo
              ? 'Ended'
              : membership.role === 'lead'
                ? 'Manager changes lead'
                : 'View only'}
          </span>
        )}
      </TableCell>
    </TableRow>
  )
}
