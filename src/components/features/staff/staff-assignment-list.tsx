/**
 * StaffAssignmentList — user-level table of assigned staff with edit and unassign actions.
 * Groups assignments by userId so each row represents a user, not an individual assignment.
 */

import { useMemo } from 'react'
import type { MemberLike, TeamLike, AssignmentLike } from '#/lib/lookups'
import { buildMemberLookup, buildTeamLookup } from '#/lib/lookups'
import type { Action } from '#/components/hooks/use-action'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '#/components/ui/table'
import { Users } from 'lucide-react'
import { EmptyState } from '#/components/ui/empty-state'
import { UserAssignmentRow, resolveTeamDisplay } from './staff-assignment-row'

type Props = Readonly<{
  assignments: ReadonlyArray<AssignmentLike>
  members: ReadonlyArray<MemberLike>
  teams: ReadonlyArray<TeamLike>
  removeAction: Action<{ data: { assignmentId: string } }>
  onEditUser: (userId: string) => void
}>

interface UserRow {
  userId: string
  assignmentIds: string[]
  teamIds: Array<string | null>
  portalCount: number
}

export function StaffAssignmentList({
  assignments,
  members,
  teams,
  removeAction,
  onEditUser,
}: Props) {
  const memberLookup = buildMemberLookup(members)
  const teamLookup = buildTeamLookup(teams)

  const userRows = useMemo<UserRow[]>(() => {
    const grouped = new Map<
      string,
      {
        userId: string
        assignmentIds: string[]
        teamIds: Array<string | null>
        portalIds: Set<string>
      }
    >()
    for (const a of assignments) {
      const existing = grouped.get(a.userId)
      if (existing) {
        existing.assignmentIds.push(a.id)
        existing.teamIds.push(a.teamId)
        if (a.portalId) existing.portalIds.add(a.portalId)
      } else {
        const portalIds = new Set<string>()
        if (a.portalId) portalIds.add(a.portalId)
        grouped.set(a.userId, {
          userId: a.userId,
          assignmentIds: [a.id],
          teamIds: [a.teamId],
          portalIds,
        })
      }
    }
    return Array.from(grouped.values()).map(({ portalIds, ...rest }) => ({
      ...rest,
      portalCount: portalIds.size,
    }))
  }, [assignments])

  if (userRows.length === 0) {
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
          <TableHead>Portals</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {userRows.map((row) => (
          <UserAssignmentRow
            key={row.userId}
            row={row}
            displayName={memberLookup.get(row.userId)?.name ?? row.userId}
            memberEmail={memberLookup.get(row.userId)?.email}
            teamDisplay={resolveTeamDisplay(row.teamIds, teamLookup)}
            onEdit={onEditUser}
            removeAction={removeAction}
          />
        ))}
      </TableBody>
    </Table>
  )
}
