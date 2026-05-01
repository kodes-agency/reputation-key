/**
 * TeamCard — a single team row with expand/collapse, inline edit mode, and delete.
 * Uses AlertDialog for destructive delete confirmation.
 */

import { useState } from 'react'
import type { Action } from '#/components/hooks/use-action'
import type { MemberLike, AssignmentLike } from '#/lib/lookups'
import { groupAssignmentsByTeam } from '#/lib/lookups'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { Separator } from '#/components/ui/separator'
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
import { ChevronRight, Pencil, Trash2 } from 'lucide-react'
import { EditTeamForm } from '#/components/features/team/EditTeamForm'
import type { UpdateTeamInput } from '#/contexts/team/application/dto/update-team.dto'
import { TeamMemberList } from '#/components/features/team/TeamMemberList'

// fallow-ignore-next-line unused-type
export interface TeamData {
  id: string
  name: string
  description: string | null
  teamLeadId: string | null
}

type Props = Readonly<{
  team: TeamData
  propertyId: string
  allAssignments: ReadonlyArray<AssignmentLike>
  members: ReadonlyArray<MemberLike>
  updateAction: Action<{ data: UpdateTeamInput }>
  deleteAction: Action<{ data: { teamId: string } }>
  addMemberAction: Action<{
    data: { userId: string; propertyId: string; teamId: string }
  }>
  removeMemberAction: Action<{ data: { assignmentId: string } }>
}>

export function TeamCard({
  team,
  propertyId,
  allAssignments,
  members,
  updateAction,
  deleteAction,
  addMemberAction,
  removeMemberAction,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const assignmentsByTeam = groupAssignmentsByTeam(allAssignments)
  const teamAssignmentIds = assignmentsByTeam.get(team.id) ?? []
  const teamAssignments = allAssignments.filter((a) => a.teamId === team.id)

  if (editing) {
    return (
      <div className="rounded-lg border p-4">
        <EditTeamForm
          teamId={team.id}
          initialName={team.name}
          initialDescription={team.description ?? null}
          initialTeamLeadId={team.teamLeadId ?? null}
          members={members.map((m) => ({
            userId: m.userId,
            name: m.name,
            email: m.email,
          }))}
          mutation={updateAction}
          onCancel={() => setEditing(false)}
        />
      </div>
    )
  }

  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setExpanded(!expanded)}
            aria-label={expanded ? 'Collapse team' : 'Expand team'}
          >
            <ChevronRight
              className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
          </Button>
          <div>
            <h3 className="flex items-center gap-2 font-medium">
              {team.name}
              <Badge variant="secondary">
                {teamAssignmentIds.length}{' '}
                {teamAssignmentIds.length === 1 ? 'member' : 'members'}
              </Badge>
            </h3>
            {team.description && (
              <p className="text-sm text-muted-foreground">{team.description}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil />
            Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={deleteAction.isPending}
              >
                <Trash2 />
                Remove
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {team.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This team and all its member assignments will be removed. You can
                  recreate the team later.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteAction({ data: { teamId: team.id } })}
                  disabled={deleteAction.isPending}
                  className="bg-destructive text-white hover:bg-destructive/90"
                >
                  {deleteAction.isPending ? 'Removing...' : 'Remove team'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      {expanded && (
        <>
          <Separator />
          <TeamMemberList
            teamId={team.id}
            propertyId={propertyId}
            assignments={teamAssignments}
            members={members}
            addAction={addMemberAction}
            removeAction={removeMemberAction}
          />
        </>
      )}
    </div>
  )
}
