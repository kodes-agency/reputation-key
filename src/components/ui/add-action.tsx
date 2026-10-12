import type { ComponentProps } from 'react'
import { createLink } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { Button, type ButtonProps } from '#/components/ui/button'

// The control that adds a thing to a list: a Plus, then the label, in the default
// Button. A page's primary add sits in its PageHeader `actions`; a card or a tab
// that owns a list may carry its own (Add staff, Add portal). The label is
// sentence case and says what it adds (see "Action copy" in `components/CONTEXT.md`
// for Add, New, Create, Invite and Import). Height and the phone tap target are
// the Button's: a page never restyles it.

type AddActionProps = Omit<ButtonProps, 'asChild' | 'size'> &
  Readonly<{
    /** `sm` for an add that sits in a card's header beside a title. */
    size?: 'default' | 'sm'
  }>

/** A button that adds something: opens a dialog or a menu, or runs the action. */
function AddAction({ children, type = 'button', ...props }: AddActionProps) {
  return (
    <Button type={type} {...props}>
      <Plus aria-hidden />
      {children}
    </Button>
  )
}

function AddAnchor({
  variant,
  size,
  children,
  // The router marks a link current whenever the location is at or below its path.
  // A link that adds is a command, not a place in a nav, so neither mark is drawn
  // (see BackLink).
  'aria-current': _routerCurrent,
  'data-status': _routerStatus,
  ...props
}: ComponentProps<'a'> &
  Pick<AddActionProps, 'variant' | 'size'> &
  Readonly<{ 'data-status'?: string }>) {
  return (
    <Button asChild variant={variant} size={size}>
      <a {...props}>
        <Plus aria-hidden />
        {children}
      </a>
    </Button>
  )
}

const RouterAddLink = createLink(AddAnchor)

/** No router class either: an add is styled by its Button alone. */
const NO_ROUTER_STYLE = {}

/** An add that is a page of its own (New goal, Import from Google): a router link. */
const AddActionLink = ((props: ComponentProps<typeof RouterAddLink>) => (
  <RouterAddLink activeProps={NO_ROUTER_STYLE} {...props} />
)) as typeof RouterAddLink

export { AddAction, AddActionLink }
export type { AddActionProps }
