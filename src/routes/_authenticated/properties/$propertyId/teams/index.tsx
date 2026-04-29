// Teams within a property — list, create, edit, and manage members
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
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
import { useAction, wrapAction } from '#/components/hooks/use-action'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/teams/')({
  loader: async ({ params: { propertyId } }) => {
    const [{ teams }, { members }, { assignments }] = await Promise.all([
      listTeams({ data: { propertyId } }),
      listMembers(),
      listStaffAssignments({ data: { propertyId } }),
    ])
    return { teams, members, assignments }
  },
  component: TeamListPage,
})

function TeamListPage() {
  const { propertyId } = Route.useParams()
  const router = useRouter()
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null)
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null)

  const { teams, members, assignments } = Route.useLoaderData()

  const createTeamFn = useAction(useServerFn(createTeam))
  const updateTeamFn = useAction(useServerFn(updateTeam))
  const deleteTeamFn = useAction(useServerFn(deleteTeam))
  const createAssignmentFn = useAction(useServerFn(createStaffAssignment))
  const removeAssignmentFn = useAction(useServerFn(removeStaffAssignment))

  const createMutation = wrapAction(createTeamFn, async () => {
    await router.invalidate()
    toast.success('Team created')
  })

  const updateMutation = wrapAction(updateTeamFn, async () => {
    setEditingTeamId(null)
    await router.invalidate()
    toast.success('Team updated')
  })

  async function handleDeleteTeam(teamId: string) {
    try {
      await deleteTeamFn({ data: { teamId } })
      await router.invalidate()
      toast.success('Team removed')
    } catch (error) {
      toast.error('Failed to remove team', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    }
  }

  async function handleAssignMember(input: { userId: string; teamId: string }) {
    try {
      await createAssignmentFn({
        data: {
          userId: input.userId,
          propertyId,
          teamId: input.teamId,
        },
      })
      await router.invalidate()
      toast.success('Member added to team')
    } catch (error) {
      toast.error('Failed to add member', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    }
  }

  async function handleRemoveAssignment(assignmentId: string) {
    try {
      await removeAssignmentFn({ data: { assignmentId } })
      await router.invalidate()
      toast.success('Member removed from team')
    } catch (error) {
      toast.error('Failed to remove member', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    }
  }

  // Build member lookup: userId → { name, email }
  const memberLookup = new Map<string, { name: string; email: string }>()
  for (const m of members) {
    memberLookup.set(m.userId, { name: m.name, email: m.email })
  }

  // Group assignments by teamId
  const assignmentsByTeam = new Map<string, string[]>()
  const assignmentUserLookup = new Map<string, string>()
  for (const a of assignments) {
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
    return members.filter((m) => !teamUserIds.has(m.userId))
  }

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
            members={members}
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
                      members={members}
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
                          onClick={() => handleDeleteTeam(team.id)}
                          disabled={deleteTeamFn.isPending}
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
                                      onClick={() => handleRemoveAssignment(aId)}
                                      disabled={removeAssignmentFn.isPending}
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
                                    handleAssignMember({ userId, teamId: team.id })
                                  }}
                                  disabled={createAssignmentFn.isPending}
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
