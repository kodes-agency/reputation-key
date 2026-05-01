// Teams within a property — table view with links to detail pages
import { createFileRoute, Link } from '@tanstack/react-router'
import { listTeams, createTeam, deleteTeam } from '#/contexts/team/server/teams'
import { listStaffAssignments } from '#/contexts/staff/server/staff-assignments'
import { listMembers } from '#/contexts/identity/server/organizations'
import { CreateTeamForm } from '#/components/features/team/CreateTeamForm'
import {
  useMutationAction,
  useMutationActionSilent,
} from '#/components/hooks/use-mutation-action'
import { toMemberOptions } from '#/lib/lookups'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { EmptyState } from '#/components/ui/empty-state'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
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
import { Plus, Users, Trash2 } from 'lucide-react'
import { useState } from 'react'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/teams/')({
  staleTime: 30_000,
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
  const { teams: initialTeams, members, assignments } = Route.useLoaderData()
  const [teams, setTeams] = useState(initialTeams)

  // Sync when loader data changes (e.g. after router.invalidate)
  if (initialTeams !== teams && initialTeams.length >= teams.length) {
    setTeams(initialTeams)
  }

  const [createOpen, setCreateOpen] = useState(false)

  const createMutation = useMutationAction(createTeam, {
    successMessage: 'Team created',
    onSuccess: async () => {
      setCreateOpen(false)
    },
  })
  const deleteMutation = useMutationActionSilent(deleteTeam)

  const handleDelete = async (teamId: string) => {
    await deleteMutation({ data: { teamId } })
    setTeams((prev) => prev.filter((t) => t.id !== teamId))
  }

  const memberOptions = toMemberOptions(members)

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Teams</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create and manage teams for this property.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
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
              mutation={createMutation}
              members={memberOptions}
            />
          </DialogContent>
        </Dialog>
      </div>

      {teams.length === 0 ? (
        <EmptyState icon={Users} title="No teams yet">
          <p className="text-sm text-muted-foreground">
            Create a team to group staff members.
          </p>
        </EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teams.map(
              (team: {
                id: string
                name: string
                description: string | null
                teamLeadId: string | null
              }) => {
                const count = assignments.filter(
                  (a: { teamId: string | null }) => a.teamId === team.id,
                ).length
                return (
                  <TableRow key={team.id}>
                    <TableCell>
                      <Link
                        to="/properties/$propertyId/teams/$teamId"
                        params={{ propertyId, teamId: team.id }}
                        className="font-medium hover:underline"
                      >
                        {team.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {count} {count === 1 ? 'member' : 'members'}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate text-muted-foreground">
                      {team.description || '\u2014'}
                    </TableCell>
                    <TableCell className="text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:text-destructive"
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="size-3.5" />
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {team.name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This team and all its member assignments will be removed.
                              You can recreate the team later.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDelete(team.id)}
                              disabled={deleteMutation.isPending}
                              className="bg-destructive text-white hover:bg-destructive/90"
                            >
                              {deleteMutation.isPending ? 'Deleting...' : 'Delete team'}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                )
              },
            )}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
