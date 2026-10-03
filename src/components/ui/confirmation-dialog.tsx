// The confirm-and-act shell: a trigger, a question, Cancel, and one confirm
// action. Extracted from the Property lifecycle dialogs so every confirmation in
// the app is one shape rather than a hand-assembled AlertDialog.
//
// `tone` is the colour of the confirm button and nothing else. `destructive` is
// for actions the person cannot take back (remove a member, delete a link,
// disconnect Google, end a goal); a reversible one (archive, restore) stays
// `neutral`. The colour is the last cue before the click, so it must not vary
// for the same kind of action.
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

export type ConfirmationTone = 'neutral' | 'destructive'

export function ConfirmationDialog({
  trigger,
  title,
  description,
  cancelLabel,
  confirmLabel,
  pendingLabel,
  pending,
  tone = 'neutral',
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
  tone?: ConfirmationTone
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
          <AlertDialogAction
            variant={tone === 'destructive' ? 'destructive' : 'default'}
            disabled={pending || confirmDisabled}
            onClick={onConfirm}
          >
            {pending ? pendingLabel : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
