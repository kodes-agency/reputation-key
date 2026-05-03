import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  listStaffAssignments,
  createStaffAssignment,
  removeStaffAssignment,
} from '#/contexts/staff/server/staff-assignments'
import { listTeams, createTeam } from '#/contexts/team/server/teams'
import { listMembers } from '#/contexts/identity/server/organizations'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { StaffAssignmentList } from '#/components/features/staff/StaffAssignmentList'
import { AssignStaffForm } from '#/components/features/staff/AssignStaffForm'
import { CreateTeamForm } from '#/components/features/team/CreateTeamForm'
import {
  useMutationAction,
  useMutationActionSilent,
} from '#/components/hooks/use-mutation-action'
import { toMemberOptions, toTeamOptions } from '#/lib/lookups'
import type { TeamLike, MemberLike } from '#/lib/lookups'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Plus } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/people')({
  staleTime: 30_000,
  loader: async ({ params: { propertyId } }) => {
    const [{ assignments }, { members }, { teams }] = await Promise.all([
      listStaffAssignments({ data: { propertyId } }),
      listMembers(),
      listTeams({ data: { propertyId } }),
    ])
    return { assignments, members, teams }
  },
  component: PeoplePage,
})

function PeoplePage() {
  const { propertyId } = Route.useParams()
  const { assignments, members, teams } = Route.useLoaderData()
  const [tab, setTab] = useState('staff')
  const [assignOpen, setAssignOpen] = useState(false)
  const [createTeamOpen, setCreateTeamOpen] = useState(false)

  const memberOptions = toMemberOptions(members)
  const teamOptions = toTeamOptions(teams)
  const assignedUserIds = new Set(assignments.map((a: { userId: string }) => a.userId))

  const assignMutation = useMutationActionSilent(createStaffAssignment)
  const removeMutation = useMutationAction(removeStaffAssignment, {
    successMessage: 'Staff member unassigned',
  })
  const createTeamMutation = useMutationAction(createTeam, {
    successMessage: 'Team created',
    onSuccess: async () => {
      setCreateTeamOpen(false)
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">People</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage staff assignments, team members, and organization directory.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="staff">Staff</TabsTrigger>
          <TabsTrigger value="teams">Teams</TabsTrigger>
          <TabsTrigger value="directory">Directory</TabsTrigger>
        </TabsList>

        <TabsContent value="staff" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus />
                  Assign Staff
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Assign Staff</DialogTitle>
                  <DialogDescription>
                    Select staff members to assign to this property.
                  </DialogDescription>
                </DialogHeader>
                <AssignStaffForm
                  propertyId={propertyId}
                  mutation={assignMutation}
                  members={memberOptions}
                  teams={teamOptions}
                  assignedUserIds={assignedUserIds}
                />
              </DialogContent>
            </Dialog>
          </div>
          <StaffAssignmentList
            assignments={assignments}
            members={memberOptions}
            teams={teamOptions}
            removeAction={removeMutation}
          />
        </TabsContent>

        <TabsContent value="teams" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Dialog open={createTeamOpen} onOpenChange={setCreateTeamOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus />
                  Create Team
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create a new team</DialogTitle>
                  <DialogDescription>
                    Group staff members into teams for this property.
                  </DialogDescription>
                </DialogHeader>
                <CreateTeamForm
                  propertyId={propertyId}
                  mutation={createTeamMutation}
                  members={memberOptions}
                />
              </DialogContent>
            </Dialog>
          </div>
          {teams.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No teams yet. Create a team to group staff members.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {teams.map((team: TeamLike) => (
                <div
                  key={team.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div>
                    <p className="font-semibold">{team.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {
                        assignments.filter(
                          (a: { teamId: string | null }) => a.teamId === team.id,
                        ).length
                      }{' '}
                      members
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="directory" className="mt-4">
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No members found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member: MemberLike & { role?: string }) => (
                  <TableRow key={member.userId}>
                    <TableCell className="font-medium">{member.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {member.email}
                    </TableCell>
                    <TableCell>
                      {member.role ? (
                        <Badge variant="secondary">{member.role}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
