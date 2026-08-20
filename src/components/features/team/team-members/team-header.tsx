import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { UserPlus } from 'lucide-react'
import { AddMembersDialogContent } from './add-members-dialog-content'
type ParticipationOption = Readonly<{ id: string; displayName: string }>

type AddDialogProps = Readonly<{
  isOpen: boolean
  available: ReadonlyArray<ParticipationOption>
  selectedIds: Set<string>
  error: unknown
  isAdding: boolean
  onOpenChange: (open: boolean) => void
  onToggleMember: (staffParticipationId: string) => void
  onToggleAll: () => void
  onAdd: () => void
}>

type Props = Readonly<{
  memberCount: number
  availableCount: number
  addDialog: AddDialogProps
}>

export function TeamHeader({ memberCount, availableCount, addDialog }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="team-members-heading" className="text-sm font-medium">
        {memberCount} {memberCount === 1 ? 'member' : 'members'}
      </h2>
      {availableCount > 0 && (
        <Dialog open={addDialog.isOpen} onOpenChange={addDialog.onOpenChange}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <UserPlus />
              Add members
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add team members</DialogTitle>
              <DialogDescription>
                Select active staff at this property to add to the team.
              </DialogDescription>
            </DialogHeader>
            <AddMembersDialogContent
              available={addDialog.available}
              selectedIds={addDialog.selectedIds}
              onToggleMember={addDialog.onToggleMember}
              onToggleAll={addDialog.onToggleAll}
              onAdd={addDialog.onAdd}
              onCancel={() => addDialog.onOpenChange(false)}
              error={addDialog.error}
              isAdding={addDialog.isAdding}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
