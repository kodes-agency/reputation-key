// The five measures as one ruled strip (board 07). Each cell says what it
// counts, prints the figure, and gives one line under it (portal-results-cells).
import { Star } from 'lucide-react'
import { Metric, MetricStrip, MetricValue } from '#/components/ui/metric-strip'
import type { ResultsCell } from './portal-results-cells'

function Figure({ cell }: Readonly<{ cell: ResultsCell }>) {
  if (cell.unit !== 'star') return cell.value
  return (
    <span className="inline-flex items-center gap-1">
      {cell.value}
      <Star
        aria-hidden="true"
        className="size-4 fill-amber-500 text-amber-500 @3xl:size-5"
      />
      <span className="sr-only">out of 5 stars</span>
    </span>
  )
}

export function PortalResultsStrip({
  cells,
}: Readonly<{ cells: readonly ResultsCell[] }>) {
  return (
    <MetricStrip aria-label="Portal results" variant="ruled">
      {cells.map((cell) => (
        <Metric key={cell.key} label={cell.label}>
          <MetricValue value={<Figure cell={cell} />} detail={cell.detail ?? undefined} />
        </Metric>
      ))}
    </MetricStrip>
  )
}
