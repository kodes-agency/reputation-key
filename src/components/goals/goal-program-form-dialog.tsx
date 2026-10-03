import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'

type GoalProgramFormDialogProps = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The change is being saved, so the dialog cannot be dismissed meanwhile. */
  busy: boolean
  /** The label of the outline button that opens the dialog. */
  trigger: string
  title: string
  description: string
  onSubmit: () => void
  /** The form's fields, notices and footer. */
  children: ReactNode
}>

/** The shell of a dialog that changes a Goal Program: one form under a header. */
export function GoalProgramFormDialog({
  open,
  onOpenChange,
  busy,
  trigger,
  title,
  description,
  onSubmit,
  children,
}: GoalProgramFormDialogProps) {
  return (
    <Dialog open={open} busy={busy} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">{trigger}</Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onSubmit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
        </form>
      </DialogContent>
    </Dialog>
  )
}
