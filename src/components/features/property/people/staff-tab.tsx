import { useState, useMemo } from 'react'
import { TabsContent } from '#/components/ui/tabs'
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
import { StaffAssignmentList, AssignStaffForm } from '#/components/features/staff'
import { EditStaffPortalsModal } from '#/components/features/staff/edit-staff-portals-modal'
import { useMutationActionSilent } from '#/components/hooks/use-mutation-action'
import type { updateStaffPortals } from '#/contexts/staff/server/staff-assignments'
import type { Action } from '#/components/hooks/use-action'
import type { MemberLike, TeamLike } from '#/lib/lookups'
import type { PortalOption } from '#/components/features/staff/portal-selector'
import type { CreateStaffAssignmentInput } from '#/contexts/staff/application/dto/staff-assignment.dto'

interface StaffTabProps {
  propertyId: string
  assignments: ReadonlyArray<{
    id: string
    userId: string
    teamId: string | null
    portalId: string | null
  }>
  memberOptions: MemberLike[]
  teamOptions: TeamLike[]
  portalOptions: PortalOption[]
  assignedUserIds: Set<string>
  assignMutation: Action<{ data: CreateStaffAssignmentInput }>
  removeMutation: Action<{ data: { assignmentId: string } }>
  assignOpen: boolean
  onAssignOpenChange: (open: boolean) => void
  updateStaffPortalsFn: typeof updateStaffPortals
}

export function StaffTab({
  propertyId,
  assignments,
  memberOptions,
  teamOptions,
  portalOptions,
  assignedUserIds,
  assignMutation,
  removeMutation,
  assignOpen,
  onAssignOpenChange,
  updateStaffPortalsFn,
}: StaffTabProps) {
  const [editingUserId, setEditingUserId] = useState<string | null>(null)

  const updatePortalsMutation = useMutationActionSilent(updateStaffPortalsFn, {
    invalidateRoutes: [
      '/_authenticated/properties/$propertyId/people',
      '/_authenticated/properties/$propertyId',
    ],
    onSuccess: () => {
      setEditingUserId(null)
    },
  })

  // Compute current portal IDs for the user being edited
  const editingUserAssignments = useMemo(() => {
    if (editingUserId == null) return []
    return assignments.filter((a) => a.userId === editingUserId)
  }, [editingUserId, assignments])

  const editingUserPortalIds = useMemo(
    () =>
      editingUserAssignments
        .map((a) => a.portalId)
        .filter((id): id is string => id != null),
    [editingUserAssignments],
  )

  const editingUserName = useMemo(() => {
    if (editingUserId == null) return ''
    const member = memberOptions.find((m) => m.userId === editingUserId)
    return member ? member.name : editingUserId
  }, [editingUserId, memberOptions])

  return (
    <TabsContent value="staff" className="mt-4 space-y-4">
      <div className="flex justify-end">
        <Dialog open={assignOpen} onOpenChange={onAssignOpenChange}>
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
                Select staff members and portals to assign to this property.
              </DialogDescription>
            </DialogHeader>
            <AssignStaffForm
              propertyId={propertyId}
              mutation={assignMutation}
              members={memberOptions}
              teams={teamOptions}
              portals={portalOptions}
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
        onEditUser={setEditingUserId}
      />

      {editingUserId != null && (
        <EditStaffPortalsModal
          key={editingUserId}
          userId={editingUserId}
          userName={editingUserName}
          propertyId={propertyId}
          currentPortalIds={editingUserPortalIds}
          allPortals={portalOptions}
          updateAction={updatePortalsMutation}
          open={editingUserId != null}
          onOpenChange={(open) => {
            if (!open) setEditingUserId(null)
          }}
        />
      )}
    </TabsContent>
  )
}
