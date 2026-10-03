// The confirm-and-act shell: a trigger, a question, Cancel, and one confirm
// action. Extracted from the Property lifecycle dialogs so every confirmation in
// the app is one shape rather than a hand-assembled AlertDialog.
//
// `tone` is the colour of the confirm button and nothing else. `destructive` is
// for actions the person cannot take back (remove a member, delete a link,
// disconnect Google, end a goal); a reversible one (archive, restore) stays
// `neutral`. The colour is the last cue before the click, so it must not vary
// for the same kind of action.
//
// Two ways to open it, and the types make a caller pick one: pass a `trigger`
// and it opens itself, or pass `open` with `onOpenChange` and the caller owns it.
// That is how a menu item asks, because a dialog rendered inside a DropdownMenu
// unmounts with the menu, so its state has to live above it. Passing neither is
// a type error: such a dialog could never open.
//
// `pending` and `pendingLabel` only change the confirm button for now. The
// dialog still closes on the confirm click (Radix's AlertDialogAction closes
// it), so a slow action is not visible here until the action-pending work (D2)
// keeps the dialog open with `preventDefault` while `pending` is true.
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

/** How the dialog opens: by its own trigger, or by a caller that owns the state. */
type Opening =
  | Readonly<{
      trigger: ReactNode
      open?: never
      /** Observe the dialog opening and closing; it still opens itself. */
      onOpenChange?: (open: boolean) => void
    }>
  | Readonly<{
      trigger?: never
      /** Controlled open state, for a dialog with no trigger of its own. */
      open: boolean
      onOpenChange: (open: boolean) => void
    }>

type Props = Opening &
  Readonly<{
    title: string
    description: string
    cancelLabel: string
    confirmLabel: string
    pendingLabel: string
    pending: boolean
    tone?: ConfirmationTone
    confirmDisabled?: boolean
    onConfirm: () => void
    children?: ReactNode
  }>

export function ConfirmationDialog({
  trigger,
  open,
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
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
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
