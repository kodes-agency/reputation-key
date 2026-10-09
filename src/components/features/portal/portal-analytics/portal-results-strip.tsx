// The five measures as one ruled strip (board 07). Each cell says what it
// counts, prints the figure, and gives one line under it (portal-results-cells).
// The headline, qualified scans, is a term people do not know: its label opens
// the definition, on the Results tab and on every Portals overview strip.
import type { ReactNode } from 'react'
import { Star } from 'lucide-react'
import { GlossaryTerm } from '#/components/features/shared/glossary-term'
import { Metric, MetricStrip, MetricValue } from '#/components/ui/metric-strip'
import { RESULTS_LABELS, type ResultsCell } from './portal-results-cells'

function labelOf(cell: ResultsCell): ReactNode {
  return cell.key === 'scans' ? <GlossaryTerm term="qualified-scans" /> : cell.label
}

function Figure({ cell }: Readonly<{ cell: ResultsCell }>) {
  if (cell.unit !== 'star') return cell.value
  return (
    <span className="inline-flex items-center gap-1">
      {cell.value}
      <Star aria-hidden="true" className="size-4 fill-current text-rating @3xl:size-5" />
      <span className="sr-only">out of 5 stars</span>
    </span>
  )
}

export function PortalResultsStrip({
  cells,
  notesDetail,
}: Readonly<{
  cells: readonly ResultsCell[]
  /** Stands in for the Private notes cell's own detail line (the Inbox link). */
  notesDetail?: ReactNode
}>) {
  return (
    <MetricStrip aria-label="Portal results" variant="ruled">
      {cells.map((cell) => (
        <Metric key={cell.key} label={labelOf(cell)}>
          <MetricValue
            value={<Figure cell={cell} />}
            detail={
              (cell.key === 'notes' ? notesDetail : undefined) ?? cell.detail ?? undefined
            }
          />
        </Metric>
      ))}
    </MetricStrip>
  )
}

/** The strip while its figures load: every cell keeps its name, so nothing jumps. */
export function PortalResultsLoadingStrip() {
  return (
    <div aria-busy="true">
      <MetricStrip aria-label="Portal results" variant="ruled">
        {Object.values(RESULTS_LABELS).map((label) => (
          <Metric key={label} label={label} state="loading" />
        ))}
      </MetricStrip>
    </div>
  )
}
