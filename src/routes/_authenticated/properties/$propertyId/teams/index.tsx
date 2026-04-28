// Teams within a property — list, create, edit, and manage members
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import {
  listTeams,
  createTeam,
  updateTeam,
  deleteTeam,
} from '#/contexts/team/server/teams'
import {
  listStaffAssignments,
  createStaffAssignment,
  removeStaffAssignment,
} from '#/contexts/staff/server/staff-assignments'
import { listMembers } from '#/contexts/identity/server/organizations'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Badge } from '#/components/ui/badge'
import { Separator } from '#/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
} from '#/components/ui/select'
import { ChevronRight, Pencil, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { CreateTeamForm } from '#/components/features/team/CreateTeamForm'
import { EditTeamForm } from '#/components/features/team/EditTeamForm'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/teams/')({
  component: TeamListPage,
})

function TeamListPage() {
  const { propertyId } = Route.useParams()
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null)
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['teams', propertyId],
    queryFn: () => listTeams({ data: { propertyId } }),
  })

  const membersQuery = useQuery({
    queryKey: ['org-members'],
    queryFn: () => listMembers(),
  })

  const assignmentsQuery = useQuery({
    queryKey: ['staff-assignments', propertyId],
    queryFn: () => listStaffAssignments({ data: { propertyId } }),
  })

  const createMutation = useMutation({
    mutationFn: (input: {
      data: { propertyId: string; name: string; description?: string }
    }) => createTeam(input),
    onSuccess: () => {
      query.refetch()
      toast.success('Team created')
    },
    onError: (error) => {
      toast.error('Failed to create team', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: (input: {
      data: { teamId: string; name?: string; description?: string | null }
    }) => updateTeam(input),
    onSuccess: () => {
      setEditingTeamId(null)
      query.refetch()
      toast.success('Team updated')
    },
    onError: (error) => {
      toast.error('Failed to update team', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (teamId: string) => deleteTeam({ data: { teamId } }),
    onSuccess: () => {
      query.refetch()
      toast.success('Team removed')
    },
    onError: (error) => {
      toast.error('Failed to remove team', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    },
  })

  const assignMutation = useMutation({
    mutationFn: (input: { userId: string; teamId: string }) =>
      createStaffAssignment({
        data: {
          userId: input.userId,
          propertyId,
          teamId: input.teamId,
        },
      }),
    onSuccess: () => {
      assignmentsQuery.refetch()
      toast.success('Member added to team')
    },
    onError: (error) => {
      toast.error('Failed to add member', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    },
  })

  const removeAssignmentMutation = useMutation({
    mutationFn: (assignmentId: string) =>
      removeStaffAssignment({ data: { assignmentId } }),
    onSuccess: () => {
      assignmentsQuery.refetch()
      toast.success('Member removed from team')
    },
    onError: (error) => {
      toast.error('Failed to remove member', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    },
  })

  // Build member lookup: userId → { name, email }
  const memberLookup = new Map<string, { name: string; email: string }>()
  for (const m of membersQuery.data?.members ?? []) {
    memberLookup.set(m.userId, { name: m.name, email: m.email })
  }

  // Group assignments by teamId
  const assignmentsByTeam = new Map<string, string[]>()
  const assignmentUserLookup = new Map<string, string>()
  for (const a of assignmentsQuery.data?.assignments ?? []) {
    if (a.teamId) {
      const existing = assignmentsByTeam.get(a.teamId) ?? []
      existing.push(a.id)
      assignmentsByTeam.set(a.teamId, existing)
      assignmentUserLookup.set(a.id, a.userId)
    }
  }

  // Members not yet in the expanded team
  const getAvailableMembers = (teamId: string) => {
    const teamAssignmentIds = assignmentsByTeam.get(teamId) ?? []
    const teamUserIds = new Set(
      teamAssignmentIds.map((id) => assignmentUserLookup.get(id)).filter(Boolean),
    )
    return (membersQuery.data?.members ?? []).filter((m) => !teamUserIds.has(m.userId))
  }

  const teams = query.data?.teams ?? []

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">Teams</h2>

      {/* Create team form */}
      <Card>
        <CardContent className="pt-6">
          <h3 className="mb-3 text-sm font-medium">Create a new team</h3>
          <CreateTeamForm
            propertyId={propertyId}
            mutation={createMutation}
            members={membersQuery.data?.members}
          />
        </CardContent>
      </Card>

      {/* Team list */}
      {teams.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No teams yet. Create one above to group staff.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {teams.map((team) => {
            const teamAssignmentIds = assignmentsByTeam.get(team.id) ?? []
            const isExpanded = expandedTeamId === team.id

            return (
              <Card key={team.id}>
                {editingTeamId === team.id ? (
                  <CardContent className="pt-6">
                    <EditTeamForm
                      teamId={team.id}
                      initialName={team.name}
                      initialDescription={team.description ?? null}
                      initialTeamLeadId={team.teamLeadId ?? null}
                      members={membersQuery.data?.members}
                      mutation={updateMutation}
                      onCancel={() => setEditingTeamId(null)}
                    />
                  </CardContent>
                ) : (
                  <>
                    <div className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setExpandedTeamId(isExpanded ? null : team.id)}
                          aria-label={isExpanded ? 'Collapse team' : 'Expand team'}
                        >
                          <ChevronRight
                            className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
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
                            <p className="text-sm text-muted-foreground">
                              {team.description}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingTeamId(team.id)}
                        >
                          <Pencil />
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => deleteMutation.mutate(team.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 />
                          Remove
                        </Button>
                      </div>
                    </div>

                    {/* Expanded: team members */}
                    {isExpanded && (
                      <>
                        <Separator />
                        <div className="p-4">
                          <h4 className="mb-2 text-sm font-medium">Team members</h4>
                          {teamAssignmentIds.length === 0 ? (
                            <p className="mb-3 text-sm text-muted-foreground">
                              No members in this team yet.
                            </p>
                          ) : (
                            <div className="mb-3 flex flex-col gap-1">
                              {teamAssignmentIds.map((aId) => {
                                const userId = assignmentUserLookup.get(aId)
                                const member = userId ? memberLookup.get(userId) : null
                                return (
                                  <div
                                    key={aId}
                                    className="flex items-center justify-between rounded px-2 py-1"
                                  >
                                    <span className="text-sm">
                                      {member
                                        ? `${member.name} — ${member.email}`
                                        : (userId ?? aId)}
                                    </span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => removeAssignmentMutation.mutate(aId)}
                                      disabled={removeAssignmentMutation.isPending}
                                      className="text-muted-foreground hover:text-destructive"
                                    >
                                      Remove
                                    </Button>
                                  </div>
                                )
                              })}
                            </div>
                          )}

                          {/* Add member to team */}
                          {(() => {
                            const available = getAvailableMembers(team.id)
                            return available.length > 0 ? (
                              <div className="flex items-center gap-2">
                                <Select
                                  onValueChange={(userId) => {
                                    assignMutation.mutate({
                                      userId,
                                      teamId: team.id,
                                    })
                                  }}
                                  disabled={assignMutation.isPending}
                                >
                                  <SelectTrigger className="w-[280px]">
                                    <UserPlus className="text-muted-foreground" />
                                    <SelectValue placeholder="Add a member…" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectGroup>
                                      {available.map((m) => (
                                        <SelectItem key={m.userId} value={m.userId}>
                                          {m.name} — {m.email}
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                All organization members are already in this team.
                              </p>
                            )
                          })()}
                        </div>
                      </>
                    )}
                  </>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
