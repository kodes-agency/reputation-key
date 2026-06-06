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
}: StaffTabProps) {
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
      />
    </TabsContent>
  )
}
