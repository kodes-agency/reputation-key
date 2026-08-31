import { useState, type ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'

const UNASSIGNED = '__unassigned__'

export type InboxAssignmentOption = Readonly<{
  userId: string
  name: string
}>

type Props = Readonly<{
  children: ReactNode
  itemCount: number
  options: ReadonlyArray<InboxAssignmentOption>
  pending: boolean
  onConfirm: (assignedToUserId: string | null) => Promise<unknown>
}>

export function InboxBulkAssignmentDialog({
  children,
  itemCount,
  options,
  pending,
  onConfirm,
}: Props) {
  const [open, setOpen] = useState(false)
  const [selection, setSelection] = useState('')
  const changeOpen = (next: boolean) => {
    setOpen(next)
    if (!next) setSelection('')
  }
  const submit = async () => {
    if (selection === '') return
    await onConfirm(selection === UNASSIGNED ? null : selection)
    changeOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change assignment for {itemCount} items</DialogTitle>
          <DialogDescription>
            The change applies to every selected item or none. If a manager is not
            eligible for one property, no assignments will change.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="inbox-bulk-assignee">Assignment</Label>
          <Select value={selection} onValueChange={setSelection} disabled={pending}>
            <SelectTrigger id="inbox-bulk-assignee" aria-label="Assignment">
              <SelectValue placeholder="Choose a manager or release" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>Unassigned (release)</SelectItem>
              {options.map((option) => (
                <SelectItem key={option.userId} value={option.userId}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => changeOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={selection === '' || pending}>
            Apply to all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
