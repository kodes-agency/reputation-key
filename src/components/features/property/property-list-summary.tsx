// The portfolio in one line (docs/plan/property-list-table.md row 10). It
// replaces the organization setup banner: each figure the list can act on is a
// button that shows those properties. It never names a property — the rows do.
import type { ReactNode } from 'react'
import { Star } from 'lucide-react'
import { Skeleton } from '#/components/ui/skeleton'
import { cn } from '#/lib/utils'
import type { PropertyListShow } from './property-list-search-schema'
import type { DataState, PropertyListSummary } from './property-list-view'

type Props = Readonly<{
  summary: PropertyListSummary
  fleet: DataState
  setup: DataState
  show: PropertyListShow | null
  onShow: (show: PropertyListShow | undefined) => void
}>

const properties = (count: number) => (count === 1 ? '1 property' : `${count} properties`)

function Figure({
  label,
  state,
  children,
}: Readonly<{ label: string; state: DataState; children: ReactNode }>) {
  if (state === 'unavailable') return null
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-card px-4 py-3 odd:last:col-span-2 @3xl:flex-1">
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

function Value({ value, detail }: Readonly<{ value: ReactNode; detail: string }>) {
  return (
    <span className="flex flex-col items-start">
      <span className="text-lg leading-7 font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </span>
  )
}

function ShowButton({
  show,
  active,
  onShow,
  children,
}: Readonly<{
  show: PropertyListShow
  active: boolean
  onShow: Props['onShow']
  children: ReactNode
}>) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onShow(active ? undefined : show)}
      className={cn(
        '-mx-1.5 -my-1 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        active && 'bg-muted',
      )}
    >
      {children}
    </button>
  )
}

export function PropertyListSummaryStrip({ summary, fleet, setup, show, onShow }: Props) {
  const unlinked = summary.properties - summary.googleLinked

  return (
    <div className="@container">
      <dl
        aria-label="Portfolio summary"
        className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border @3xl:flex"
      >
        <Figure label="Average rating" state={fleet}>
          {summary.averageRating === null ? (
            <Value value="No ratings" detail="No property has a rating yet" />
          ) : (
            <Value
              value={
                <span className="inline-flex items-center gap-1">
                  {summary.averageRating.toFixed(1)}
                  <Star className="size-4 fill-current text-rating" aria-hidden="true" />
                  <span className="sr-only">stars</span>
                </span>
              }
              detail={`across ${summary.ratedReviews.toLocaleString()} reviews, all-time`}
            />
          )}
        </Figure>
        <Figure label="Needs attention" state={fleet}>
          {summary.needsAttention === 0 ? (
            <Value value="0" detail="Nothing waiting" />
          ) : (
            <ShowButton show="attention" active={show === 'attention'} onShow={onShow}>
              <Value
                value={summary.needsAttention}
                detail={`in ${properties(summary.propertiesNeedingAttention)}`}
              />
            </ShowButton>
          )}
        </Figure>
        <Figure label="Setup to finish" state={setup}>
          {summary.propertiesWithSetupLeft === 0 ? (
            <Value value="0" detail="All set up" />
          ) : (
            <ShowButton show="setup" active={show === 'setup'} onShow={onShow}>
              <Value
                value={summary.propertiesWithSetupLeft}
                detail={summary.propertiesWithSetupLeft === 1 ? 'property' : 'properties'}
              />
            </ShowButton>
          )}
        </Figure>
        <Figure label="Google" state="ready">
          {unlinked === 0 ? (
            <Value
              value={`${summary.googleLinked} of ${summary.properties}`}
              detail="All linked"
            />
          ) : (
            <ShowButton show="google" active={show === 'google'} onShow={onShow}>
              <Value
                value={`${summary.googleLinked} of ${summary.properties}`}
                detail={`linked · ${unlinked} not`}
              />
            </ShowButton>
          )}
        </Figure>
      </dl>
    </div>
  )
}
