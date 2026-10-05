import type { ComponentProps } from 'react'
import { createLink } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { Button, type ButtonProps } from '#/components/ui/button'
import { IconButton } from '#/components/ui/icon-button'
import { cn } from '#/lib/utils'

// The one way back. A page that has breadcrumbs goes up through them; a surface
// with no room for them (a full-bleed workspace header, the Inbox's detail pane)
// and a step that returns to the one before wear this: a ghost, small Button with
// the one arrow. `BackLink` goes to an address; `BackButton` changes what the page
// shows. They look the same, so a person reads one gesture.

type BackOptions = Readonly<{
  /** Where it goes, as "Back to <place>" ("Back to portals", "Back to editing"). Always its name. */
  label: string
  /**
   * Draw only the arrow below this width (a tap target wide), the label kept as
   * the name a screen reader hears: for a header row that is short of room.
   */
  iconBelow?: 'sm' | 'md'
  /** Never draw words: an arrow with the label as its name and its tooltip. */
  iconOnly?: boolean
  /**
   * Pull the control into the padding beside it, so the arrow rather than the
   * button's box sits on the content edge. Set it on the first control of a header.
   */
  flush?: boolean
}>

const FLUSH_TEXT = '-ml-2'
/** A square button has more margin around its arrow than a text one. */
const FLUSH_ICON = '-ml-2.5'

function Words({ label, iconBelow }: Readonly<Pick<BackOptions, 'label' | 'iconBelow'>>) {
  if (iconBelow === undefined) return label
  const reveal = iconBelow === 'sm' ? 'sm:not-sr-only' : 'md:not-sr-only'
  return <span className={cn('sr-only', reveal)}>{label}</span>
}

function BackAnchor({
  label,
  iconBelow,
  iconOnly,
  flush,
  className,
  // The router marks a link current whenever the location is at or below its
  // path, which is true of every page under the one a way back leads to. A way
  // back is never where the person is, so neither mark is drawn (see NavLink).
  'aria-current': _routerCurrent,
  'data-status': _routerStatus,
  ...props
}: ComponentProps<'a'> & BackOptions & Readonly<{ 'data-status'?: string }>) {
  if (iconOnly) {
    return (
      <IconButton
        asChild
        label={label}
        size="icon-sm"
        className={cn(flush && FLUSH_ICON, className)}
      >
        <a {...props}>
          <ArrowLeft />
        </a>
      </IconButton>
    )
  }
  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      iconBelow={iconBelow}
      className={cn(flush && FLUSH_TEXT, className)}
    >
      <a {...props}>
        <ArrowLeft aria-hidden />
        <Words label={label} iconBelow={iconBelow} />
      </a>
    </Button>
  )
}

const RouterBackLink = createLink(BackAnchor)

/** No router class either: a way back is styled by its Button alone. */
const NO_ROUTER_STYLE = {}

/** A router link back to a place (typed `to`, `params`, `search`), drawn as the one back control. */
const BackLink = ((props: ComponentProps<typeof RouterBackLink>) => (
  <RouterBackLink activeProps={NO_ROUTER_STYLE} {...props} />
)) as typeof RouterBackLink

type BackButtonProps = Omit<
  ButtonProps,
  'asChild' | 'children' | 'variant' | 'size' | 'aria-label'
> &
  BackOptions

/** A back control that is not an address: it changes what the page shows (a step, a view). */
function BackButton({
  label,
  iconBelow,
  iconOnly,
  flush,
  className,
  ...props
}: BackButtonProps) {
  if (iconOnly) {
    return (
      <IconButton
        {...props}
        label={label}
        size="icon-sm"
        className={cn(flush && FLUSH_ICON, className)}
      >
        <ArrowLeft />
      </IconButton>
    )
  }
  return (
    <Button
      type="button"
      {...props}
      variant="ghost"
      size="sm"
      iconBelow={iconBelow}
      className={cn(flush && FLUSH_TEXT, className)}
    >
      <ArrowLeft aria-hidden />
      <Words label={label} iconBelow={iconBelow} />
    </Button>
  )
}

export { BackButton, BackLink }
export type { BackButtonProps }
