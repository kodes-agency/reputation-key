// The app's dialog. Three things are decided here so no caller spells them:
//
// - How wide it is: `size` (sm, md, lg, xl), not a `sm:max-w-*` per dialog.
// - How tall it can get: the viewport less a 1rem margin on every side, in `dvh`
//   so a phone's address bar does not hide the footer, and the dialog scrolls
//   inside that box. The footer is pinned to the bottom of it, so Cancel and the
//   primary action stay on screen while the body scrolls under them; the title
//   and the corner close scroll with the body.
// - Whether it can be dismissed mid-request: `busy`, or `useDialogBusy` from a
//   body that owns the mutation (dialog-dismissal.ts).
//
// The corner close is a Button (dialog-close-button.tsx). A dialog whose footer
// has Cancel may drop it with `showCloseButton={false}`; the footer's Cancel is
// `DialogCancel`, so it looks and behaves the same in every dialog.
import * as React from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'

import { cn } from '#/lib/utils'
import { Button } from '#/components/ui/button'
import { DialogCloseButton } from '#/components/ui/dialog-close-button'
import {
  DialogBusyContext,
  useDialogIsBusy,
  useDismissalGuard,
} from '#/components/ui/dialog-dismissal'

type DialogProps = React.ComponentProps<typeof DialogPrimitive.Root> & {
  /**
   * A request is in flight: Escape, the overlay and the close button are refused
   * until it settles. Leave it off for a dialog with nothing to commit.
   */
  busy?: boolean
}

function Dialog({
  busy = false,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  ...props
}: DialogProps) {
  const { store, guard } = useDismissalGuard(busy)
  // Always controlled underneath, so a refused close cannot slip through an
  // uncontrolled dialog's own state.
  const [ownOpen, setOwnOpen] = React.useState(defaultOpen)
  const isControlled = openProp !== undefined
  const handleOpenChange = guard((next) => {
    if (!isControlled) setOwnOpen(next)
    onOpenChange?.(next)
  })
  return (
    <DialogBusyContext value={store}>
      <DialogPrimitive.Root
        data-slot="dialog"
        open={isControlled ? openProp : ownOpen}
        onOpenChange={handleOpenChange}
        {...props}
      />
    </DialogBusyContext>
  )
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  )
}

/**
 * The widths a dialog comes in, from the recipes the dialogs spelled by hand:
 * `sm` a short list (24rem), `md` a form of a few fields (32rem, the default),
 * `lg` a form with a column of choices (42rem), `xl` a form beside its preview
 * (56rem). Below `sm` every size is the window less 1rem a side.
 */
const DIALOG_SIZE = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
} as const

type DialogSize = keyof typeof DIALOG_SIZE

/**
 * The footer, pinned. The dialog's padding is `--dialog-pad` (a caller that wants
 * less sets the variable, not `p-*`), so the footer can reach back over it: it
 * bleeds into the padding on three sides and keeps its own, with the dialog's
 * background behind it. A sticky box measures its offset from the scroll box's
 * content edge, not its padding edge, so `-bottom-(--dialog-pad)` is what puts the
 * stuck footer flush with the dialog's bottom. When the dialog fits, this draws
 * what the grid's own gap and padding would. When it scrolls, the body slides
 * under the footer and fades out just above it. It must sit in the dialog's
 * scroll box, directly or as the last thing in the form that is, and be the last
 * thing in it.
 */
const PINNED_FOOTER =
  'sticky -bottom-(--dialog-pad) z-10 -mx-(--dialog-pad) -mb-(--dialog-pad) bg-background px-(--dialog-pad) pb-(--dialog-pad) before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-4 before:bg-linear-to-t before:from-background before:to-transparent'

/**
 * Whether the dialog draws the corner close. Its header reads this, wherever it
 * sits (a form's first child, not only a direct child of the content), so the
 * title leaves the close room at its end: the close is a tap target (44px) below
 * `md`, so the room is wider there and still leaves a gap.
 */
const DialogCornerCloseContext = React.createContext(false)

function DialogContent({
  className,
  children,
  showCloseButton = true,
  size = 'md',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  size?: DialogSize
}) {
  const isBusy = useDialogIsBusy()
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-size={size}
        aria-busy={isBusy || undefined}
        className={cn(
          'fixed top-[50%] left-[50%] z-50 grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto rounded-lg border bg-background p-(--dialog-pad) shadow-lg [--dialog-pad:1.5rem] duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          DIALOG_SIZE[size],
          className,
        )}
        {...props}
      >
        <DialogCornerCloseContext value={showCloseButton}>
          {children}
        </DialogCornerCloseContext>
        {showCloseButton && <DialogCloseButton disabled={isBusy} />}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  const hasCornerClose = React.useContext(DialogCornerCloseContext)
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        'flex flex-col gap-2',
        hasCornerClose &&
          '[&>[data-slot=dialog-title]]:pe-12 md:[&>[data-slot=dialog-title]]:pe-8',
        className,
      )}
      {...props}
    />
  )
}

/**
 * The actions of a dialog: Cancel (`DialogCancel`) then the primary, at the end.
 * `note` is the line that sits at the start of the same row (a selection count,
 * "Nothing is public until you publish", a shortcut hint); on a phone the
 * actions come first and the note under them.
 */
function DialogFooter({
  className,
  showCloseButton = false,
  note,
  noteClassName,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean
  note?: React.ReactNode
  noteClassName?: string
}) {
  const actions = (
    <>
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </>
  )
  if (!note) {
    return (
      <div
        data-slot="dialog-footer"
        className={cn(
          PINNED_FOOTER,
          'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
          className,
        )}
        {...props}
      >
        {actions}
      </div>
    )
  }
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        PINNED_FOOTER,
        'flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
      {...props}
    >
      <div
        data-slot="dialog-footer-note"
        className={cn(
          'flex min-w-0 items-center gap-2 text-sm text-muted-foreground',
          noteClassName,
        )}
      >
        {note}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">{actions}</div>
    </div>
  )
}

/**
 * Cancel: an outline Button that closes the dialog, held back while a request is
 * in flight. One look for it, so a footer never chooses ghost or outline.
 */
function DialogCancel({
  children = 'Cancel',
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'variant' | 'asChild'>) {
  const isBusy = useDialogIsBusy()
  return (
    <DialogPrimitive.Close asChild>
      <Button type="button" variant="outline" disabled={isBusy} {...props}>
        {children}
      </Button>
    </DialogPrimitive.Close>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export type { DialogSize }
export {
  Dialog,
  DialogCancel,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
