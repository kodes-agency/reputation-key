import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '#/lib/utils'
import { TONE_INK, TONE_SURFACE } from './tone'

// The first six variants are looks; the last four are tones, the colour of a
// state (UI consistency scan: COLL-05). A tone is a tinted pill with its own
// edge and ink from `tone.ts`; when the badge is a link the EDGE steps under the
// pointer and the fill stays put, because the ink's contrast was measured on that
// fill. A domain status should go through StatusBadge, which also draws the
// tone's icon and keeps the raw status token off the screen.
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
        destructive:
          'bg-destructive text-white focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90',
        outline:
          'border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        ghost: '[a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        link: 'text-link underline-offset-4 [a&]:hover:underline',
        positive: `${TONE_SURFACE.positive} ${TONE_INK.positive} [a&]:hover:border-current`,
        warn: `${TONE_SURFACE.warn} ${TONE_INK.warn} [a&]:hover:border-current`,
        negative: `${TONE_SURFACE.negative} ${TONE_INK.negative} [a&]:hover:border-current`,
        neutral: `${TONE_SURFACE.neutral} ${TONE_INK.neutral} [a&]:hover:border-current`,
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span'

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants, type BadgeVariant }
