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
import type { MemberLike } from '#/lib/lookups'

type AddDialogProps = Readonly<{
  isOpen: boolean
  available: ReadonlyArray<MemberLike>
  selectedIds: Set<string>
  error: unknown
  isAdding: boolean
  onOpenChange: (open: boolean) => void
  onToggleMember: (userId: string) => void
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
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-sm font-medium">
          {memberCount} {memberCount === 1 ? 'member' : 'members'}
        </h2>
      </div>
      {availableCount > 0 && (
        <Dialog open={addDialog.isOpen} onOpenChange={addDialog.onOpenChange}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <UserPlus />
              Add Members
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add team members</DialogTitle>
              <DialogDescription>
                Select people from your organization to add to this team.
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
