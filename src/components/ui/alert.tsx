import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '#/lib/utils'
import { TONE_ICON, TONE_INK, TONE_SURFACE } from './tone'

// A notice in the flow of a page or a dialog. `default` is a plain card for a
// notice that carries its own icon; the other four are tones, and a tone draws
// its icon itself (`tone.ts`), so a caller names the tone and writes the words:
//
//   destructive  something failed or is blocked   red tint
//   warning      this needs a person, or may break amber tint
//   success      it worked                         green tint
//   info         worth knowing, nothing to do      accent tint
//
// `destructive` wears the same red tint and edge as a failed toast and the
// negative Badge: on the card surface it was barely a box in the dark theme, so
// the same refusal looked different depending on what showed it. It is the form
// error recipe, so it also sets its description in the red (a refusal's own
// words); the other three tones keep the quiet ink for the description so a long
// sentence is not set in a colour, and the title and icon carry the tone.
// `destructive` and `warning` are announced at once (`role="alert"`): something
// failed or needs a person. `info`, `success` and `default` are read in turn
// (`role="status"`), so a notice that is already on the page when it loads does
// not interrupt a screen reader. A caller can still pass `role`.
const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive: `${TONE_SURFACE.negative} ${TONE_INK.negative} *:data-[slot=alert-description]:text-negative`,
        warning: `${TONE_SURFACE.warn} ${TONE_INK.warn}`,
        success: `${TONE_SURFACE.positive} ${TONE_INK.positive}`,
        info: `${TONE_SURFACE.info} ${TONE_INK.info}`,
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

type AlertVariant = NonNullable<VariantProps<typeof alertVariants>['variant']>

/** The icon a tone draws; `default` draws none and leaves it to the caller. */
const VARIANT_ICON: Readonly<Partial<Record<AlertVariant, React.ElementType>>> = {
  destructive: TONE_ICON.negative,
  warning: TONE_ICON.warn,
  success: TONE_ICON.positive,
  info: TONE_ICON.info,
}

/** The variants that interrupt; every other one waits its turn. */
const ASSERTIVE_VARIANTS: ReadonlySet<AlertVariant> = new Set(['destructive', 'warning'])

function Alert({
  className,
  variant = 'default',
  children,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  const Icon = variant === null ? undefined : VARIANT_ICON[variant]
  const assertive = variant !== null && ASSERTIVE_VARIANTS.has(variant)
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      role={assertive ? 'alert' : 'status'}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {Icon ? <Icon aria-hidden="true" /> : null}
      {children}
    </div>
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        'col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight',
        className,
      )}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'col-start-2 grid justify-items-start gap-1 text-sm text-muted-foreground [&_p]:leading-relaxed',
        className,
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, alertVariants }
