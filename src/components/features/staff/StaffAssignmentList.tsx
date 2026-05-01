/**
 * StaffAssignmentList — table of assigned staff with unassign actions.
 * Extracted from property staff route.
 */

import type { MemberLike, TeamLike, AssignmentLike } from '#/lib/lookups'
import { buildMemberLookup, buildTeamLookup } from '#/lib/lookups'
import type { Action } from '#/components/hooks/use-action'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Users } from 'lucide-react'
import { EmptyState } from '#/components/ui/empty-state'

type Props = Readonly<{
  assignments: ReadonlyArray<AssignmentLike>
  members: ReadonlyArray<MemberLike>
  teams: ReadonlyArray<TeamLike>
  removeAction: Action<{ data: { assignmentId: string } }>
}>

export function StaffAssignmentList({
  assignments,
  members,
  teams,
  removeAction,
}: Props) {
  const memberLookup = buildMemberLookup(members)
  const teamLookup = buildTeamLookup(teams)

  if (assignments.length === 0) {
    return (
      <EmptyState icon={Users} title="No staff assigned">
        <p className="text-sm text-muted-foreground">
          Assign staff members to this property using the form above.
        </p>
      </EmptyState>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Team</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {assignments.map((a) => {
          const member = memberLookup.get(a.userId)
          const teamName = a.teamId ? teamLookup.get(a.teamId) : null
          return (
            <TableRow key={a.id}>
              <TableCell className="font-medium">
                {member ? member.name : a.userId}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {member ? member.email : ''}
              </TableCell>
              <TableCell>
                {teamName ? (
                  <Badge variant="secondary">{teamName}</Badge>
                ) : (
                  <span className="text-muted-foreground">Direct</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                    >
                      Unassign
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Unassign {member ? member.name : 'this staff member'}?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        They will no longer be assigned to this property. You can reassign
                        them later.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => removeAction({ data: { assignmentId: a.id } })}
                        disabled={removeAction.isPending}
                        className="bg-destructive text-white hover:bg-destructive/90"
                      >
                        {removeAction.isPending ? 'Removing...' : 'Unassign'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
