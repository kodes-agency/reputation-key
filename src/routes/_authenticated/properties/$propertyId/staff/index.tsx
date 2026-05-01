// Staff assignments for a property — list and assign
import { createFileRoute } from '@tanstack/react-router'
import {
  listStaffAssignments,
  createStaffAssignment,
  removeStaffAssignment,
} from '#/contexts/staff/server/staff-assignments'
import { listTeams } from '#/contexts/team/server/teams'
import { listMembers } from '#/contexts/identity/server/organizations'
import { AssignStaffForm } from '#/components/features/staff/AssignStaffForm'
import { StaffAssignmentList } from '#/components/features/staff/StaffAssignmentList'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { toMemberOptions, toTeamOptions } from '#/lib/lookups'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Plus } from 'lucide-react'
import { useState } from 'react'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/staff/')({
  staleTime: 30_000,
  loader: async ({ params: { propertyId } }) => {
    const [{ assignments }, { members }, { teams }] = await Promise.all([
      listStaffAssignments({ data: { propertyId } }),
      listMembers(),
      listTeams({ data: { propertyId } }),
    ])
    return { assignments, members, teams }
  },
  component: StaffListPage,
})

function StaffListPage() {
  const { propertyId } = Route.useParams()
  const { assignments, members, teams } = Route.useLoaderData()
  const [assignOpen, setAssignOpen] = useState(false)

  const assignMutation = useMutationAction(createStaffAssignment, {
    successMessage: 'Staff member assigned',
    onSuccess: () => setAssignOpen(false),
  })
  const removeMutation = useMutationAction(removeStaffAssignment, {
    successMessage: 'Staff member unassigned',
  })

  const memberOptions = toMemberOptions(members)
  const teamOptions = toTeamOptions(teams)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Staff</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Assign staff members to this property.
          </p>
        </div>
        <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus />
              Assign Staff
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Assign Staff Member</DialogTitle>
              <DialogDescription>Add a staff member to this property.</DialogDescription>
            </DialogHeader>
            <AssignStaffForm
              propertyId={propertyId}
              mutation={assignMutation}
              members={memberOptions}
              teams={teamOptions}
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
    </div>
  )
}
