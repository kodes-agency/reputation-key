// The portfolio in one line (docs/plan/property-list-table.md row 10). It
// replaces the organization setup banner: each figure the list can act on is a
// button that shows those properties. It never names a property — the rows do.
import type { ReactNode } from 'react'
import { Metric, MetricStrip, MetricValue } from '#/components/ui/metric-strip'
import { RatingFigure } from '#/components/ui/rating-figure'
import { cn } from '#/lib/utils'
import type { PropertyListShow } from './property-list-search-schema'
import type { DataState, PropertyListSummary } from './property-list-view'
import { formatNumber } from '#/lib/format'

type Props = Readonly<{
  summary: PropertyListSummary
  fleet: DataState
  setup: DataState
  show: PropertyListShow | null
  onShow: (show: PropertyListShow | undefined) => void
}>

const properties = (count: number) => (count === 1 ? '1 property' : `${count} properties`)

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
        '-mx-1.5 -my-1 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted focus-ring',
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
    <MetricStrip aria-label="Portfolio summary">
      <Metric label="Average rating" state={fleet}>
        {summary.averageRating === null ? (
          <MetricValue value="No ratings" detail="No property has a rating yet" />
        ) : (
          <MetricValue
            value={<RatingFigure value={summary.averageRating} size="md" />}
            detail={`across ${formatNumber(summary.ratedReviews)} reviews, all-time`}
          />
        )}
      </Metric>
      <Metric label="Needs attention" state={fleet}>
        {summary.needsAttention === 0 ? (
          <MetricValue value="0" detail="Nothing waiting" />
        ) : (
          <ShowButton show="attention" active={show === 'attention'} onShow={onShow}>
            <MetricValue
              value={summary.needsAttention}
              detail={`in ${properties(summary.propertiesNeedingAttention)}`}
            />
          </ShowButton>
        )}
      </Metric>
      <Metric label="Setup to finish" state={setup}>
        {summary.propertiesWithSetupLeft === 0 ? (
          <MetricValue value="0" detail="All set up" />
        ) : (
          <ShowButton show="setup" active={show === 'setup'} onShow={onShow}>
            <MetricValue
              value={summary.propertiesWithSetupLeft}
              detail={summary.propertiesWithSetupLeft === 1 ? 'property' : 'properties'}
            />
          </ShowButton>
        )}
      </Metric>
      <Metric label="Google" state="ready">
        {unlinked === 0 ? (
          <MetricValue
            value={`${summary.googleLinked} of ${summary.properties}`}
            detail="All linked"
          />
        ) : (
          <ShowButton show="google" active={show === 'google'} onShow={onShow}>
            <MetricValue
              value={`${summary.googleLinked} of ${summary.properties}`}
              detail={`linked · ${unlinked} not`}
            />
          </ShowButton>
        )}
      </Metric>
    </MetricStrip>
  )
}
