// A row of headline figures as a description list: each cell is a term (what is
// measured) and its figure (`MetricValue`: the number, then one line of context).
// Extracted from the property list's portfolio strip
// (`features/property/property-list-summary.tsx`) so the portal Results tab and
// the portal home can print the same strip.
//
// Four looks, one structure (UI consistency scan: COLL-04):
//
// - `boxed` (the default): a bordered, rounded strip of `bg-card` cells one
//   hairline apart. The property list uses it. Dense strips.
// - `ruled`: no fill, hairlines above and below and between the cells, the first
//   cell flush left. The portal Results and Activity strips and the dashboard
//   topic pages use it. Narrow, it turns into the phone board's (AP11) bordered,
//   rounded card of two columns with internal hairlines and a smaller figure.
//   Page strips.
// - `embedded`: the boxed cells with no frame of their own, for a strip that sits
//   in a Card, which is the frame.
// - `tiles`: separate bordered tiles that wrap, for a set of independent measures
//   that is longer than a row (an import's counts, an analytics summary). Two
//   columns narrow, `columns` (3 or 4) from `2xl`.
//
// The strip is a `@container`, so it lays itself out by the width of the column
// it sits in, not the window: two columns in a narrow pane, one row from `3xl`
// (`tiles` wrap instead).
import { cva, type VariantProps } from 'class-variance-authority'
import { Skeleton } from '#/components/ui/skeleton'
import { cn } from '#/lib/utils'
import { createContext, use, type ReactNode } from 'react'

const metricStripVariants = cva('m-0 grid grid-cols-2', {
  variants: {
    variant: {
      boxed: 'gap-px overflow-hidden rounded-lg border bg-border @3xl:flex',
      embedded: 'gap-px overflow-hidden bg-border @3xl:flex',
      ruled: 'rounded-lg border @3xl:flex @3xl:rounded-none @3xl:border-x-0',
      tiles: 'gap-3',
    },
  },
  defaultVariants: { variant: 'boxed' },
})

/** How many columns a wrapping strip has from `2xl`. */
const TILE_COLUMNS = { 3: '@2xl:grid-cols-3', 4: '@2xl:grid-cols-4' } as const

/** A cell's chrome, per look. `ruled` draws its dividers on the cells. */
const metricCellVariants = cva('flex min-w-0 flex-col', {
  variants: {
    variant: {
      boxed: 'gap-1 bg-card px-4 py-3 odd:last:col-span-2 @3xl:flex-1',
      embedded: 'gap-1 bg-card px-4 py-3 odd:last:col-span-2 @3xl:flex-1',
      ruled:
        'gap-0.5 px-3 py-2.5 odd:last:col-span-2 nth-[n+3]:border-t even:border-l @3xl:flex-1 @3xl:px-4 @3xl:py-3 @3xl:nth-[n+3]:border-t-0 @3xl:border-l @3xl:first:border-l-0 @3xl:first:pl-0',
      tiles: 'gap-1 rounded-lg border p-4',
    },
  },
  defaultVariants: { variant: 'boxed' },
})

type Variant = NonNullable<VariantProps<typeof metricStripVariants>['variant']>

/** The cells take their look from the strip, so a caller states it once. */
const MetricStripVariantContext = createContext<Variant>('boxed')

type StripProps = Readonly<{
  /** Names the list: a strip of numbers with no name is noise to a screen reader. */
  'aria-label': string
  variant?: Variant
  /** For `tiles`: how many columns from `2xl`. Narrow, a strip is always two. */
  columns?: keyof typeof TILE_COLUMNS
  className?: string
  children?: ReactNode
}>

export function MetricStrip({
  'aria-label': ariaLabel,
  variant = 'boxed',
  columns = 4,
  className,
  children,
}: StripProps) {
  return (
    <div className="@container">
      <dl
        aria-label={ariaLabel}
        data-slot="metric-strip"
        data-variant={variant}
        className={cn(
          metricStripVariants({ variant }),
          variant === 'tiles' && TILE_COLUMNS[columns],
          className,
        )}
      >
        <MetricStripVariantContext value={variant}>{children}</MetricStripVariantContext>
      </dl>
    </div>
  )
}

/** What is measured: 12px, medium, muted. Anything that prints a term over a figure wears it. */
export const METRIC_LABEL_CLASS = 'text-xs font-medium text-muted-foreground'

/**
 * Whether a measure has a figure yet. `unavailable` leaves the cell out
 * altogether — a strip with a hollow cell says a number exists that we will not
 * show — and `loading` keeps the term and shows a skeleton where the figure goes.
 */
export type MetricState = 'ready' | 'loading' | 'unavailable'

type MetricProps = Readonly<{
  /** What is measured: a phrase, or a glossary term that explains itself. */
  label: ReactNode
  state?: MetricState
  className?: string
  children?: ReactNode
}>

/**
 * The skeleton stands where the figure and its detail will: 28 + 16 in a boxed
 * cell, 32 + 2 + 16 (rounded to 48) in a ruled one, so a figure arriving does
 * not move the cell.
 */
const SKELETON_CLASS = {
  boxed: 'h-11 w-24',
  embedded: 'h-11 w-24',
  ruled: 'h-12 w-24',
  tiles: 'h-12 w-24',
} as const satisfies Record<Variant, string>

export function Metric({ label, state = 'ready', className, children }: MetricProps) {
  const variant = use(MetricStripVariantContext)
  if (state === 'unavailable') return null
  return (
    <div className={cn(metricCellVariants({ variant }), className)}>
      <dt className={METRIC_LABEL_CLASS}>{label}</dt>
      <dd className="m-0">
        {state === 'loading' ? (
          <Skeleton className={SKELETON_CLASS[variant]} aria-hidden="true" />
        ) : (
          children
        )}
      </dd>
    </div>
  )
}

type ValueProps = Readonly<{
  /** The figure. `null` is a measure with no number: only its `detail` is printed, saying why. */
  value: ReactNode | null
  /** One line of context under the figure: a share, a comparison, a count. */
  detail?: ReactNode
}>

/**
 * The figure's type: 18/28 semibold in a boxed strip; in a ruled one 24/32 bold
 * from `3xl` and 20/24 bold in the phone card, tightened by 0.3 px as the boards do.
 */
const FIGURE_CLASS = {
  boxed: 'text-lg leading-7 font-semibold',
  embedded: 'text-lg leading-7 font-semibold',
  ruled: 'text-xl leading-6 font-bold tracking-[-0.3px] @3xl:text-2xl @3xl:leading-8',
  tiles: 'text-2xl leading-8 font-semibold',
} as const satisfies Record<Variant, string>

/** A tile's figure, for a tile that is not a `Metric` cell (a link tile): 24/32 semibold. */
export const METRIC_TILE_FIGURE_CLASS = `tabular-nums ${FIGURE_CLASS.tiles}`

export function MetricValue({ value, detail }: ValueProps) {
  const variant = use(MetricStripVariantContext)
  return (
    <span className="flex flex-col items-start gap-0.5">
      {value === null ? null : (
        <span className={cn('tabular-nums', FIGURE_CLASS[variant])}>{value}</span>
      )}
      {detail === undefined || detail === null || detail === false ? null : (
        <span className="text-xs text-muted-foreground">{detail}</span>
      )}
    </span>
  )
}
