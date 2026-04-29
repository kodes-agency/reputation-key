// Staff assignments for a property — list and assign
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
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
import { UserX } from 'lucide-react'
import { toast } from 'sonner'
import { AssignStaffForm } from '#/components/features/staff/AssignStaffForm'
import type { MemberOption } from '#/components/features/staff/AssignStaffForm'
import { useAction, wrapAction } from '#/components/hooks/use-action'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/staff/')({
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
  const router = useRouter()
  const { assignments, members, teams } = Route.useLoaderData()

  // Build a lookup map: userId → { name, email }
  const memberLookup = new Map<string, MemberOption>()
  for (const m of members) {
    memberLookup.set(m.userId, { userId: m.userId, name: m.name, email: m.email })
  }

  // Build team lookup: teamId → name
  const teamLookup = new Map<string, string>()
  for (const t of teams) {
    teamLookup.set(t.id, t.name)
  }

  const createAssignment = useAction(useServerFn(createStaffAssignment))
  const removeAssignment = useAction(useServerFn(removeStaffAssignment))

  const assignMutation = wrapAction(createAssignment, async () => {
    await router.invalidate()
    toast.success('Staff member assigned')
  })

  async function handleRemove(assignmentId: string) {
    try {
      await removeAssignment({ data: { assignmentId } })
      await router.invalidate()
      toast.success('Staff member unassigned')
    } catch (error) {
      toast.error('Failed to unassign staff', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    }
  }

  const teamOptions = teams.map((t) => ({ id: t.id, name: t.name }))

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
            teams={teamOptions}
          />
        </CardContent>
      </Card>

      {/* Staff list */}
      {assignments.length === 0 ? (
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
                    onClick={() => handleRemove(a.id)}
                    disabled={removeAssignment.isPending}
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
