// The five measure cells of a row in the Portals overview (boards 01 and 10):
// qualified scans, private ratings, the average, Google opens and private notes,
// right-aligned so the figures line up down the table. Each is one figure, and
// where there is none it says why: "Too few" for an average the sample is too
// small to show, a dash for anything still processing or that cannot be counted.
// Never a zero that was not counted. A reason is a button, not a tooltip: it opens
// on a keyboard and on a phone, where there is no hover.
//
// Below a 56 rem container the table is a stack of cards and these cells are not
// drawn; the row carries one summary line instead (`rowMeasures().summary`).
import { Star } from 'lucide-react'
import { ExplainTrigger } from '#/components/ui/explain-trigger'
import { Popover, PopoverContent } from '#/components/ui/popover'
import { Skeleton } from '#/components/ui/skeleton'
import { TableCell } from '#/components/ui/table'
import { cn } from '#/lib/utils'
import { DASH } from '../portal-analytics/portal-results-cells'
import { useOverviewClasses } from './portal-overview-density'
import type { MeasureFigure, MeasureSlot, RowMeasures } from './portal-overview-results'

/** The columns, in board order; the header row and the cells share this list. */
export const MEASURE_COLUMNS = [
  { key: 'scans', label: 'Qualified scans' },
  { key: 'ratings', label: 'Private ratings' },
  { key: 'average', label: 'Average' },
  { key: 'googleOpens', label: 'Opened Google' },
  { key: 'notes', label: 'Private notes' },
] as const satisfies ReadonlyArray<{ key: keyof RowMeasures; label: string }>

const MEASURE_COLUMN_COUNT = MEASURE_COLUMNS.length

const MISSING: MeasureFigure = { text: '—', unit: null, tone: 'missing', reason: null }

function MeasureValue({
  figure,
  label,
}: Readonly<{ figure: MeasureFigure; label: string }>) {
  if (figure.tone === 'figure') {
    return (
      <>
        {figure.text}
        {figure.unit === 'star' ? (
          <>
            <Star
              aria-hidden="true"
              className="ml-1 inline size-3.5 fill-current align-[-1px] text-rating"
            />
            <span className="sr-only"> out of 5 stars</span>
          </>
        ) : null}
      </>
    )
  }
  if (figure.tone === 'withheld' && figure.reason !== null) {
    return <WithheldFigure label={label} text={figure.text} reason={figure.reason} />
  }
  return (
    <span title={figure.reason ?? undefined} className="text-muted-foreground">
      {figure.text}
      <span className="sr-only">{` ${figure.reason ?? 'No figure available'}`}</span>
    </span>
  )
}

const sentence = (text: string): string =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}${text.endsWith('.') ? '' : '.'}`

/**
 * A figure held back on purpose ("Too few", a dash for scans nobody counted) and
 * the reason, in a popover: the dotted cue says it can be asked, and a keyboard or
 * a finger can ask it, which a title on a span never allowed.
 */
function WithheldFigure({
  label,
  text,
  reason,
}: Readonly<{ label: string; text: string; reason: string }>) {
  return (
    <Popover>
      <ExplainTrigger
        aria-label={
          text === DASH ? `${label}: ${reason}` : `${label}: ${text}. ${reason}`
        }
        className="text-muted-foreground"
      >
        {text}
      </ExplainTrigger>
      <PopoverContent align="end" aria-label={label} className="w-64 text-sm">
        <p>{sentence(reason)}</p>
      </PopoverContent>
    </Popover>
  )
}

type Props = Readonly<{
  slot: MeasureSlot
  /** A draft has no results to show: one line says so across the columns. */
  draft?: boolean
  /** A group's head reads a little heavier than a Portal's row. */
  strong?: boolean
}>

export function PortalMeasureCells({ slot, draft = false, strong = false }: Props) {
  const classes = useOverviewClasses()
  if (slot.kind === 'off') return null
  if (draft) {
    return (
      <TableCell colSpan={MEASURE_COLUMN_COUNT} className={classes.measureSpan}>
        No results until it’s published
      </TableCell>
    )
  }
  return (
    <>
      {MEASURE_COLUMNS.map(({ key, label }) => (
        <TableCell key={key} className={cn(classes.measureCell, strong && 'font-medium')}>
          {slot.kind === 'loading' ? (
            <Skeleton aria-hidden="true" className="ml-auto h-4 w-10" />
          ) : (
            <MeasureValue
              label={label}
              figure={slot.kind === 'figures' ? slot.measures[key] : MISSING}
            />
          )}
        </TableCell>
      ))}
    </>
  )
}
