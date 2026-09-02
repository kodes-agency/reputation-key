// The shared confirm-and-act shell behind every Property lifecycle dialog.
// Extracted so each dialog file stays about its own copy and preconditions.
import type { ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'

export function ConfirmationDialog({
  trigger,
  title,
  description,
  cancelLabel,
  confirmLabel,
  pendingLabel,
  pending,
  confirmDisabled = false,
  onConfirm,
  onOpenChange,
  children,
}: Readonly<{
  trigger: ReactNode
  title: string
  description: string
  cancelLabel: string
  confirmLabel: string
  pendingLabel: string
  pending: boolean
  confirmDisabled?: boolean
  onConfirm: () => void
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
}>) {
  return (
    <AlertDialog onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction disabled={pending || confirmDisabled} onClick={onConfirm}>
            {pending ? pendingLabel : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
