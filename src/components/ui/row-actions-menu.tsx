// The "more actions" menu of one row, card or block (UI consistency scan: COLL-02,
// ACT-06). Extracted from the Portal and Property kebabs, which were built per
// screen with a different size, ink, name and item recipe each.
//
// - The trigger is an `IconButton`: ghost, the three-dots glyph, touch-sized from
//   the Button's own sizes (never a per-file class), named "More actions for
//   {name}" and with no tooltip, because the menu it opens says what it is.
// - An item is a `RowActionsItem`: `destructive` for an action the person cannot
//   take back (the same rule as `ConfirmationDialog`'s `tone`), and `opensDialog`
//   for one that asks for more before it acts, which ends its label in an ellipsis.
//   A link item (`asChild`) writes its own label, so it spells its own ellipsis.
// - Link ink is not a concern here: `styles.css` leaves `dropdown-menu-item` to
//   the menu primitive, so no item pins a colour.
//
// A dialog an item opens is held by the caller, outside the menu: a dialog mounted
// inside a menu item closes with the menu.
import type { ComponentProps, ReactNode } from 'react'
import { Ellipsis, type LucideIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { IconButton, type IconButtonProps } from '#/components/ui/icon-button'
import { cn } from '#/lib/utils'

const ELLIPSIS = '…'

/** The trigger's accessible name: one phrasing, with no colon. */
export function rowActionsLabel(name: string): string {
  return `More actions for ${name}`
}

/**
 * `default` is a control (32px from `md`, a tap target below it). `small` is for
 * a dense feed row (24px from `md`) that stays a tap target on a phone.
 */
const TRIGGER_SIZE = {
  default: { size: 'icon-sm', touch: false },
  small: { size: 'icon-xs', touch: true },
} as const

/** `wide` is for items that carry a second line of explanation. */
const CONTENT_WIDTH = { default: 'min-w-48', wide: 'w-72' } as const

type TriggerProps = Omit<
  IconButtonProps,
  'label' | 'children' | 'size' | 'variant' | 'tooltip' | 'asChild'
>

type Props = TriggerProps &
  Readonly<{
    /** What the menu acts on: a row's name. The trigger reads "More actions for {name}". */
    name: string
    /** `ghost` in a row; `outline` when the menu sits among outline controls. */
    variant?: 'ghost' | 'outline'
    size?: keyof typeof TRIGGER_SIZE
    width?: keyof typeof CONTENT_WIDTH
    align?: ComponentProps<typeof DropdownMenuContent>['align']
    /** Runs after the menu has closed, to hand focus to something it opened. */
    onCloseAutoFocus?: ComponentProps<typeof DropdownMenuContent>['onCloseAutoFocus']
    children: ReactNode
  }>

export function RowActionsMenu({
  name,
  variant = 'ghost',
  size = 'default',
  width = 'default',
  align = 'end',
  onCloseAutoFocus,
  className,
  children,
  ...trigger
}: Props) {
  return (
    <DropdownMenu>
      {/* The trigger is told it is disabled too: Radix opens on pointer down, which a disabled button can still receive. */}
      <DropdownMenuTrigger asChild disabled={trigger.disabled}>
        <IconButton
          {...trigger}
          {...TRIGGER_SIZE[size]}
          variant={variant}
          tooltip={false}
          label={rowActionsLabel(name)}
          className={cn(variant === 'ghost' && 'text-muted-foreground', className)}
        >
          <Ellipsis aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        onCloseAutoFocus={onCloseAutoFocus}
        className={CONTENT_WIDTH[width]}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type ItemProps = Omit<ComponentProps<typeof DropdownMenuItem>, 'variant' | 'asChild'> &
  Readonly<{
    /** The action cannot be taken back: the red item, like a destructive confirmation. */
    destructive?: boolean
    /** The glyph before the label. Every item in a menu has one, or none does. */
    icon?: LucideIcon
    /** A second line under the label, for an item whose effect needs a sentence. */
    description?: string
  }> &
  (
    | Readonly<{
        /** The item is its element (a router `Link`), which writes its own label. */
        asChild: true
        opensDialog?: undefined
      }>
    | Readonly<{
        asChild?: false
        /** The item opens a dialog that asks for more first: its label ends in "…". */
        opensDialog?: boolean
      }>
  )

export function RowActionsItem({
  destructive = false,
  opensDialog = false,
  icon: Icon,
  description,
  asChild = false,
  children,
  ...props
}: ItemProps) {
  const label = (
    <>
      {children}
      {opensDialog ? ELLIPSIS : null}
    </>
  )
  return (
    <DropdownMenuItem
      asChild={asChild}
      variant={destructive ? 'destructive' : 'default'}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {Icon === undefined ? null : <Icon aria-hidden="true" />}
          {description === undefined ? (
            label
          ) : (
            <span className="flex flex-col">
              <span>{label}</span>
              <span className="text-xs text-muted-foreground">{description}</span>
            </span>
          )}
        </>
      )}
    </DropdownMenuItem>
  )
}

export const RowActionsSeparator = DropdownMenuSeparator
export const RowActionsLabel = DropdownMenuLabel
