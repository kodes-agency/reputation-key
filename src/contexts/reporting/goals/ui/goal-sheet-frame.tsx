// Both responsive frames use Dialog so busy requests cannot be dismissed. Prefer the
// step's data-autofocus target over the first button. There is no Radix trigger, so
// callers must supply focus restoration. A step may supply its own changing heading.

import type { ReactNode, Ref } from 'react'
import { useIsMobile } from '#/components/hooks/use-mobile'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { SheetContent } from '#/components/ui/sheet'

/**
 * The title and description of a sheet. The title takes the focus when a step
 * changes (`titleRef`, tabIndex -1), so a keyboard or screen-reader user hears
 * where they are now instead of being left on a button that is gone; on a phone
 * it keeps clear of the corner close.
 */
export function GoalSheetHeader({
  title,
  description,
  titleRef,
  phone,
}: Readonly<{
  title: string
  /** What the screen is for, or where it is: one line. */
  description: string
  titleRef?: Ref<HTMLHeadingElement>
  phone: boolean
}>) {
  return (
    <DialogHeader>
      <DialogTitle
        ref={titleRef}
        tabIndex={-1}
        className={phone ? 'pe-12 outline-none' : 'outline-none'}
      >
        {title}
      </DialogTitle>
      <DialogDescription>{description}</DialogDescription>
    </DialogHeader>
  )
}

/** With a heading, both lines; without, the step draws its own. */
type Heading =
  | Readonly<{
      title: string
      description: string
      titleRef?: Ref<HTMLHeadingElement>
    }>
  | Readonly<{ title?: never; description?: never; titleRef?: never }>

type Props = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A save is running: Escape, the overlay and the close are refused. */
  busy: boolean
  /**
   * The attribute the frame is found by (a story, a test, a journey); its value
   * is `sheet` on a phone and `dialog` on a desktop.
   */
  marker: `data-${string}`
  /** Opening: where the focus goes. The step's `data-autofocus` stop, when not given. */
  onOpenAutoFocus?: (event: Event) => void
  /** Where the focus goes on closing: there is no trigger for Radix to return it to. */
  onCloseAutoFocus?: (event: Event) => void
  /** The step's body, then its `DialogFooter`, last; given whether it is drawn on a phone. */
  children: ReactNode | ((phone: boolean) => ReactNode)
}> &
  Heading

/** Opening: the focus goes to the step's own first stop, when it has one. */
function focusStepStart(event: Event): void {
  const content = event.currentTarget
  if (!(content instanceof HTMLElement)) return
  const start = content.querySelector<HTMLElement>('[data-autofocus]')
  if (start === null) return
  event.preventDefault()
  start.focus()
}

export function GoalSheetFrame({
  open,
  onOpenChange,
  busy,
  marker,
  title,
  description,
  titleRef,
  onOpenAutoFocus = focusStepStart,
  onCloseAutoFocus,
  children,
}: Props) {
  const phone = useIsMobile()
  const shown = typeof children === 'function' ? children(phone) : children
  const header =
    title === undefined ? null : (
      <GoalSheetHeader
        title={title}
        description={description}
        titleRef={titleRef}
        phone={phone}
      />
    )
  return (
    <Dialog open={open} onOpenChange={onOpenChange} busy={busy}>
      {phone ? (
        // Full screen: the sheet is the height of the window, scrolls inside, and
        // keeps the dialog's padding variable so the footer pins the same way.
        <SheetContent
          side="bottom"
          {...{ [marker]: 'sheet' }}
          onOpenAutoFocus={onOpenAutoFocus}
          onCloseAutoFocus={onCloseAutoFocus}
          className="h-dvh gap-4 overflow-y-auto p-(--dialog-pad) [--dialog-pad:1rem]"
        >
          {header}
          {shown}
        </SheetContent>
      ) : (
        <DialogContent
          size="lg"
          {...{ [marker]: 'dialog' }}
          onOpenAutoFocus={onOpenAutoFocus}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          {header}
          {shown}
        </DialogContent>
      )}
    </Dialog>
  )
}
