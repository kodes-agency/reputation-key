// Staff assignments for a property — list and assign
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  listStaffAssignments,
  createStaffAssignment,
  removeStaffAssignment,
} from '#/contexts/staff/server/staff-assignments'
import { listTeams } from '#/contexts/team/server/teams'
import { listMembers } from '#/contexts/identity/server/organizations'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Badge } from '#/components/ui/badge'
import { Skeleton } from '#/components/ui/skeleton'
import { UserX } from 'lucide-react'
import { toast } from 'sonner'
import { AssignStaffForm } from '#/components/features/staff/AssignStaffForm'
import type { MemberOption } from '#/components/features/staff/AssignStaffForm'
import type { CreateStaffAssignmentInput } from '#/contexts/staff/application/dto/staff-assignment.dto'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/staff/')({
  component: StaffListPage,
})

function StaffListPage() {
  const { propertyId } = Route.useParams()

  const query = useQuery({
    queryKey: ['staff-assignments', propertyId],
    queryFn: () => listStaffAssignments({ data: { propertyId } }),
  })

  const membersQuery = useQuery({
    queryKey: ['org-members'],
    queryFn: () => listMembers(),
  })

  const teamsQuery = useQuery({
    queryKey: ['teams', propertyId],
    queryFn: () => listTeams({ data: { propertyId } }),
  })

  // Build a lookup map: userId → { name, email }
  const memberLookup = new Map<string, MemberOption>()
  for (const m of membersQuery.data?.members ?? []) {
    memberLookup.set(m.userId, { userId: m.userId, name: m.name, email: m.email })
  }

  // Build team lookup: teamId → name
  const teamLookup = new Map<string, string>()
  for (const t of teamsQuery.data?.teams ?? []) {
    teamLookup.set(t.id, t.name)
  }

  const assignMutation = useMutation({
    mutationFn: (input: { data: CreateStaffAssignmentInput }) =>
      createStaffAssignment(input),
    onSuccess: () => {
      query.refetch()
      toast.success('Staff member assigned')
    },
    onError: (error) => {
      toast.error('Failed to assign staff', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    },
  })

  const removeMutation = useMutation({
    mutationFn: (assignmentId: string) =>
      removeStaffAssignment({ data: { assignmentId } }),
    onSuccess: () => {
      query.refetch()
      toast.success('Staff member unassigned')
    },
    onError: (error) => {
      toast.error('Failed to unassign staff', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    },
  })

  const assignments = query.data?.assignments ?? []
  const teams = (teamsQuery.data?.teams ?? []).map((t) => ({ id: t.id, name: t.name }))

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">Staff</h2>

      {/* Assign staff form */}
      <Card>
        <CardContent className="pt-6">
          <h3 className="mb-3 text-sm font-medium">Assign a staff member</h3>
          <AssignStaffForm
            propertyId={propertyId}
            mutation={assignMutation}
            members={[...memberLookup.values()]}
            teams={teams}
            isLoadingMembers={membersQuery.isLoading}
          />
        </CardContent>
      </Card>

      {/* Staff list */}
      {query.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No staff assigned to this property yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {assignments.map((a) => {
            const member = memberLookup.get(a.userId)
            const teamName = a.teamId ? teamLookup.get(a.teamId) : null
            return (
              <Card key={a.id}>
                <div className="flex items-center justify-between p-4">
                  <div className="flex flex-col gap-1">
                    <p className="font-medium">{member ? member.name : a.userId}</p>
                    {member && (
                      <p className="text-sm text-muted-foreground">{member.email}</p>
                    )}
                    {teamName && (
                      <Badge variant="secondary" className="w-fit">
                        {teamName}
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => removeMutation.mutate(a.id)}
                    disabled={removeMutation.isPending}
                  >
                    <UserX />
                    Unassign
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
