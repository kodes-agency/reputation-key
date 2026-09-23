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
  trigger,
  title,
  description,
  onSubmit,
  children,
}: GoalProgramFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">{trigger}</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
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
