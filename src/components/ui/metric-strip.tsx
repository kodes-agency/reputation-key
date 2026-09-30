// A row of headline figures as a description list: each cell is a term (what is
// measured) and its figure (`MetricValue`: the number, then one line of context).
// Extracted from the property list's portfolio strip
// (`features/property/property-list-summary.tsx`) so the portal Results tab and
// the portal home can print the same strip.
//
// Two looks, one structure:
//
// - `boxed` (the default): a bordered, rounded strip of `bg-card` cells one
//   hairline apart. The property list uses it.
// - `ruled`: no fill, hairlines above and below and between the cells, the first
//   cell flush left. The portal Results and Activity strips use it.
//
// The strip is a `@container`, so it lays itself out by the width of the column
// it sits in, not the window: two columns in a narrow pane, one row from `3xl`.
import { cva, type VariantProps } from 'class-variance-authority'
import { Skeleton } from '#/components/ui/skeleton'
import { cn } from '#/lib/utils'
import { createContext, use, type ReactNode } from 'react'

const metricStripVariants = cva('m-0 grid grid-cols-2 @3xl:flex', {
  variants: {
    variant: {
      boxed: 'gap-px overflow-hidden rounded-lg border bg-border',
      ruled: 'border-y',
    },
  },
  defaultVariants: { variant: 'boxed' },
})

/** A cell's chrome, per look. `ruled` draws its dividers on the cells. */
const metricCellVariants = cva(
  'flex min-w-0 flex-col gap-1 odd:last:col-span-2 @3xl:flex-1',
  {
    variants: {
      variant: {
        boxed: 'bg-card px-4 py-3',
        ruled:
          'px-4 py-3 nth-[n+3]:border-t even:border-l @3xl:nth-[n+3]:border-t-0 @3xl:border-l @3xl:first:border-l-0 @3xl:first:pl-0',
      },
    },
    defaultVariants: { variant: 'boxed' },
  },
)

type Variant = NonNullable<VariantProps<typeof metricStripVariants>['variant']>

/** The cells take their look from the strip, so a caller states it once. */
const MetricStripVariantContext = createContext<Variant>('boxed')

type StripProps = Readonly<{
  /** Names the list: a strip of numbers with no name is noise to a screen reader. */
  'aria-label': string
  variant?: Variant
  className?: string
  children?: ReactNode
}>

export function MetricStrip({
  'aria-label': ariaLabel,
  variant = 'boxed',
  className,
  children,
}: StripProps) {
  return (
    <div className="@container">
      <dl
        aria-label={ariaLabel}
        data-slot="metric-strip"
        data-variant={variant}
        className={cn(metricStripVariants({ variant }), className)}
      >
        <MetricStripVariantContext value={variant}>{children}</MetricStripVariantContext>
      </dl>
    </div>
  )
}

/**
 * Whether a measure has a figure yet. `unavailable` leaves the cell out
 * altogether — a strip with a hollow cell says a number exists that we will not
 * show — and `loading` keeps the term and shows a skeleton where the figure goes.
 */
export type MetricState = 'ready' | 'loading' | 'unavailable'

type MetricProps = Readonly<{
  label: string
  state?: MetricState
  className?: string
  children?: ReactNode
}>

export function Metric({ label, state = 'ready', className, children }: MetricProps) {
  const variant = use(MetricStripVariantContext)
  if (state === 'unavailable') return null
  return (
    <div className={cn(metricCellVariants({ variant }), className)}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="m-0">
        {state === 'loading' ? (
          <Skeleton className="h-11 w-24" aria-hidden="true" />
        ) : (
          children
        )}
      </dd>
    </div>
  )
}

type ValueProps = Readonly<{
  value: ReactNode
  /** One line of context under the figure: a share, a comparison, a count. */
  detail?: ReactNode
}>

/** The figure's type: 18/28 semibold in a boxed strip, 24/32 bold in a ruled one. */
const FIGURE_CLASS = {
  boxed: 'text-lg leading-7 font-semibold',
  ruled: 'text-2xl leading-8 font-bold',
} as const satisfies Record<Variant, string>

export function MetricValue({ value, detail }: ValueProps) {
  const variant = use(MetricStripVariantContext)
  return (
    <span className="flex flex-col items-start">
      <span className={cn('tabular-nums', FIGURE_CLASS[variant])}>{value}</span>
      {detail === undefined ? null : (
        <span className="text-xs text-muted-foreground">{detail}</span>
      )}
    </span>
  )
}
