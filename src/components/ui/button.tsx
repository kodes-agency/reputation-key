import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '#/lib/utils'

// Below `md` a control is at least a tap target tall: `--control-touch` is 44px, and
// 36px inside a `data-density="compact"` workspace (styles.css). It is a minimum, not
// a height, so a control that is taller on purpose (a field-like bar, a label that
// wraps) keeps its own height. From `md` the desktop heights below apply. A caller
// never re-spells either number; it sets the density on a container. Two props cover
// the cases the sizes cannot: `touch` keeps a small button (`xs`, `icon-xs`, `inline`)
// a tap target on a phone, and `iconBelow` is the button whose label hides below a
// width, a square as wide as the touch height there.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
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
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3 max-md:min-h-(--control-touch)',
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5 max-md:min-h-(--control-touch)',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4 max-md:min-h-(--control-touch)',
        icon: 'size-9 max-md:min-h-(--control-touch) max-md:min-w-(--control-touch)',
        'icon-xs': "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8 max-md:min-h-(--control-touch) max-md:min-w-(--control-touch)',
        'icon-lg':
          'size-10 max-md:min-h-(--control-touch) max-md:min-w-(--control-touch)',
        // A link set in a line of text: no height, no padding, the line's own box.
        inline: 'h-auto p-0',
      },
      touch: { true: 'max-md:min-h-(--control-touch)' },
      iconBelow: {
        sm: 'max-sm:w-(--control-touch) max-sm:px-0 max-sm:has-[>svg]:px-0',
        md: 'max-md:w-(--control-touch) max-md:px-0 max-md:has-[>svg]:px-0',
      },
    },
    compoundVariants: [
      { size: 'icon-xs', touch: true, className: 'max-md:min-w-(--control-touch)' },
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
      className={cn(buttonVariants({ variant, size, touch, iconBelow, className }))}
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

export { Button, buttonVariants }
export type { ButtonProps }
