import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '#/lib/utils'
import { PHONE_TOUCH_PAD } from './touch-pad'

// Below `md` a control is at least a tap target tall: `--control-touch` is 44px, and
// 36px inside a `data-density="compact"` workspace (styles.css). It is a minimum, not
// a height, so a deliberately taller control keeps its own height. From `md` the
// desktop heights below apply. A caller sets the density on a container, never the
// numbers. `xs` and `icon-xs` are tap targets on a phone too; `touch` makes an
// `inline` link that stands alone one; `iconBelow` hides the label below a width, leaving a square as wide as the
// touch height. `sm` and `md` are window breakpoints; `@lg` is the width of the
// nearest `@container` ancestor, for a bar in a pane the window does not size, and
// whoever sets `@lg` also hides the label under the same `@max-lg:`.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all focus-ring disabled:pointer-events-none disabled:opacity-50 aria-busy:disabled:opacity-100 aria-disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40',
        outline:
          'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-link underline-offset-4 hover:underline',
        'row-name':
          'min-w-0 shrink justify-start whitespace-normal break-words text-left text-link underline-offset-4 hover:underline',
        'scope-label':
          'flex max-w-full min-w-0 shrink items-center justify-start gap-1 rounded-sm text-xs font-normal text-muted-foreground transition-none outline-none hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 max-md:-ml-2 max-md:h-(--control-touch) max-md:rounded-md max-md:px-2 max-md:text-[13px] max-md:font-medium max-md:text-foreground',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3 max-md:min-h-(--control-touch)',
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 max-md:min-h-(--control-touch) max-md:min-w-(--control-touch) [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5 max-md:min-h-(--control-touch)',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4 max-md:min-h-(--control-touch)',
        icon: 'size-9 max-md:min-h-(--control-touch) max-md:min-w-(--control-touch)',
        'icon-xs':
          "size-6 rounded-md max-md:min-h-(--control-touch) max-md:min-w-(--control-touch) [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8 max-md:min-h-(--control-touch) max-md:min-w-(--control-touch)',
        'icon-lg':
          'size-10 max-md:min-h-(--control-touch) max-md:min-w-(--control-touch)',
        // A link set in a line of text: no height, no padding, the line's own box,
        // and below `md` a 44 px pad around it (`touch-pad.ts`). `touch` makes it a
        // flex box with the touch size instead, for one that stands alone.
        inline: `h-auto p-0 ${PHONE_TOUCH_PAD}`,
      },
      touch: { true: 'max-md:min-h-(--control-touch)' },
      wrap: { true: 'h-auto min-h-9 whitespace-normal text-balance' },
      iconBelow: {
        sm: 'max-sm:w-(--control-touch) max-sm:px-0 max-sm:has-[>svg]:px-0',
        md: 'max-md:w-(--control-touch) max-md:px-0 max-md:has-[>svg]:px-0',
        '@lg': '@max-lg:w-(--control-touch) @max-lg:px-0 @max-lg:has-[>svg]:px-0',
      },
    },
    compoundVariants: [
      {
        size: 'inline',
        touch: true,
        className:
          'max-md:inline-flex max-md:items-center max-md:justify-center max-md:min-w-(--control-touch)',
      },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /**
     * The action is in flight: a spinner, `aria-busy`, and the button is disabled.
     * Not drawn with `asChild`: a Slot has one child, which is the real element, so
     * the caller of an `asChild` Button owns its own state.
     */
    pending?: boolean
    /** Replaces the label while `pending`; without it the label stays. */
    pendingLabel?: string
  }

function Button({
  className,
  variant = 'default',
  size = 'default',
  touch,
  wrap,
  iconBelow,
  asChild = false,
  pending: isPending = false,
  pendingLabel,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  const pending = isPending && !asChild

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, touch, wrap, iconBelow, className }))}
      aria-busy={pending || undefined}
      disabled={disabled || pending || undefined}
      {...props}
    >
      {pending ? (
        <>
          <Spinner />
          {pendingLabel ?? children}
        </>
      ) : (
        children
      )}
    </Comp>
  )
}

/**
 * lucide's LoaderCircle, drawn here rather than imported: Button is in the
 * first-paint closure, and an imported icon is a chunk of its own there.
 */
function Spinner() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="animate-spin motion-reduce:animate-none"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}

export { Button, Spinner, buttonVariants }
export type { ButtonProps }
