// Read-only label/value rows (UI consistency scan: COLL-23). `ui/fact` is the
// toolbar fact (text in a ButtonGroup), not this; a figure with a caption is a
// `MetricStrip`.
//
// Each item is a term and its value in one `div`, which a `dl` allows. From `sm` the
// term has a column of its own (`termWidth`: 8rem, or 10rem for longer terms); on a
// phone it sits above the value. A list that sits among form fields (a read-only
// email, an address that comes from Google) is `stacked`: the term over the value at
// every width, the way a field's label sits over its control. The term is muted and
// the value is the text's own ink, so what is asked and what is answered read apart.
// A `note` is a quiet line under the value, for where it came from ("From Google").
import { createContext, use, type ReactNode } from 'react'
import { cn } from '#/lib/utils'

const TERM_WIDTH = {
  default: 'sm:gap-x-4 sm:grid-cols-[8rem_minmax(0,1fr)]',
  wide: 'sm:gap-x-4 sm:grid-cols-[10rem_minmax(0,1fr)]',
} as const

type ListProps = Readonly<{
  /** Names the list when its heading does not. */
  'aria-label'?: string
  termWidth?: keyof typeof TERM_WIDTH
  /** The term over the value at every width, for a list among form fields. */
  stacked?: boolean
  className?: string
  children: ReactNode
}>

/** The classes that arrange one item: its grid, or nothing but the gap when stacked. */
const ArrangementContext = createContext<string>(TERM_WIDTH.default)

export function DescriptionList({
  'aria-label': ariaLabel,
  termWidth = 'default',
  stacked = false,
  className,
  children,
}: ListProps) {
  return (
    <dl
      aria-label={ariaLabel}
      data-slot="description-list"
      className={cn('m-0 flex flex-col gap-3 text-sm', className)}
    >
      <ArrangementContext value={stacked ? '' : TERM_WIDTH[termWidth]}>
        {children}
      </ArrangementContext>
    </dl>
  )
}

type ItemProps = Readonly<{
  term: ReactNode
  /** Where the value came from, or how to read it: a quiet line under it. */
  note?: ReactNode
  /** The language of the value, when it is not the page's. */
  lang?: string
  children: ReactNode
}>

export function DescriptionItem({ term, note, lang, children }: ItemProps) {
  const arrangement = use(ArrangementContext)
  return (
    <div className={cn('grid gap-1', arrangement)}>
      <dt className="text-muted-foreground">{term}</dt>
      <dd lang={lang} className="m-0 min-w-0 text-pretty">
        {children}
        {note === undefined ? null : (
          <span className="mt-0.5 block text-xs text-muted-foreground">{note}</span>
        )}
      </dd>
    </div>
  )
}
