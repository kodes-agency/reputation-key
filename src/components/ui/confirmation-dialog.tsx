// The confirm-and-act shell: a trigger, a question, Cancel, and one confirm
// action. Every confirmation in the app is this, not a hand-assembled
// AlertDialog.
//
// `tone` is the colour of the confirm button and nothing else. `destructive` is
// for an action the person cannot take back or that loses data; a reversible one
// stays `neutral`, and so does its menu item (a red item opening a
// primary-coloured confirm contradicts itself). Reversible means the app has the
// way back: a portal group has no restore, so archiving one is `destructive`. A
// destructive confirm is started from a destructive Button
// (`ConfirmationTrigger`), a neutral one from an outline Button, or a plain
// Button when it is the page's affirmative action.
//
// Only a low-blast action the person can undo on the spot skips this dialog
// (removing a language from a draft, deleting an unsent reply draft, dismissing
// one notification).
//
// Pending contract: until `onConfirm` settles the dialog stays open, its confirm
// is a pending Button, Cancel is disabled and Escape is refused
// (dialog-dismissal.ts). When it rejects the dialog stays open and says so once,
// in a banner above the actions, so a mutation behind it passes no
// `errorMessage` (a toast as well would tell them twice). The error is held by
// the dialog's body, which mounts when it opens, so a reopened dialog never
// greets with an old one. A dialog drawn inside something its own refusal
// re-reads is unmounted with it; such a caller holds that surface still until
// the dialog closes, via `onOpenChange`.
//
// Two ways to open it, and the types make a caller pick one: pass a `trigger`,
// or pass `open` with `onOpenChange` and own the state (a dialog rendered inside
// a DropdownMenu unmounts with the menu, so its state must live above it).
//
// `children` is the body between the question and the actions.
// `confirmDisabled` holds the confirm back until the fields are valid, and
// Enter in a field confirms like the button does.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
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
import { Button, type ButtonProps } from '#/components/ui/button'
import { useDismissalGuard } from '#/components/ui/dialog-dismissal'

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
    /** The confirm's label while it runs, where a word says more than the spinner. */
    pendingLabel?: string
    tone?: ConfirmationTone
    confirmDisabled?: boolean
    /**
     * What confirming does. Resolve to close the dialog; reject to keep it open
     * with the refusal shown. A synchronous action simply returns.
     */
    onConfirm: () => Promise<unknown> | void
    /** A dialog opened from a compact workspace says so: a portal leaves its density behind. */
    density?: 'compact'
    /** Where focus goes when it closes, for a caller that knows better than the trigger. */
    onCloseAutoFocus?: (event: Event) => void
    children?: ReactNode
  }>

/**
 * The Button that opens a confirmation, drawn from its tone: destructive for a
 * destructive confirm, outline for a neutral one. A page's affirmative action
 * (Restore, Enable) is a plain Button instead.
 */
export function ConfirmationTrigger({
  tone,
  ...props
}: Omit<ButtonProps, 'variant'> & Readonly<{ tone: ConfirmationTone }>) {
  return (
    <Button
      type="button"
      variant={tone === 'destructive' ? 'destructive' : 'outline'}
      {...props}
    />
  )
}

export function ConfirmationDialog({
  trigger,
  open,
  onOpenChange,
  density,
  onCloseAutoFocus,
  ...body
}: Props) {
  const { store, guard } = useDismissalGuard()
  const [ownOpen, setOwnOpen] = useState(false)
  const isControlled = open !== undefined
  const setOpen = (next: boolean) => {
    if (!isControlled) setOwnOpen(next)
    onOpenChange?.(next)
  }

  return (
    <AlertDialog open={isControlled ? open : ownOpen} onOpenChange={guard(setOpen)}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      <AlertDialogContent data-density={density} onCloseAutoFocus={onCloseAutoFocus}>
        <ConfirmationBody {...body} hold={store.hold} close={() => setOpen(false)} />
      </AlertDialogContent>
    </AlertDialog>
  )
}

type BodyProps = Omit<
  Props,
  'trigger' | 'open' | 'onOpenChange' | 'density' | 'onCloseAutoFocus'
> &
  Readonly<{
    /** Keeps the dialog from being dismissed; returns the release. */
    hold: () => () => void
    close: () => void
  }>

/** Mounted while the dialog is open, so its pending state and error start clean. */
function ConfirmationBody({
  title,
  description,
  cancelLabel,
  confirmLabel,
  pendingLabel,
  tone = 'neutral',
  confirmDisabled = false,
  onConfirm,
  hold,
  close,
  children,
}: BodyProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  // A second press while one is running would run it twice.
  const running = useRef(false)
  const confirmButton = useRef<HTMLButtonElement>(null)

  // The confirm is natively disabled while it runs, which drops focus to <body>.
  // After a refusal it comes back, so a keyboard user is not sent to the top of
  // the dialog to try again or cancel.
  useEffect(() => {
    if (error !== null) confirmButton.current?.focus()
  }, [error])

  const confirm = async () => {
    if (running.current) return
    running.current = true
    setError(null)
    setPending(true)
    const release = hold()
    try {
      await onConfirm()
      // Stays pending: the dialog is closing, and a button that went back to its
      // label for the length of the exit animation would invite a second press.
      close()
    } catch (failure) {
      setError(failure)
      setPending(false)
    } finally {
      running.current = false
      release()
    }
  }

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      {/* A form so Enter in a field presses the confirm. The click is what runs
          it (and is prevented, so nothing is ever submitted natively). */}
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        {children}
        <FormErrorBanner error={error} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            ref={confirmButton}
            type="submit"
            variant={tone === 'destructive' ? 'destructive' : 'default'}
            pending={pending}
            pendingLabel={pendingLabel}
            disabled={confirmDisabled}
            onClick={(event) => {
              // Radix closes on this click; closing is `close()`'s job, after the
              // action settles.
              event.preventDefault()
              void confirm()
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </form>
    </>
  )
}
