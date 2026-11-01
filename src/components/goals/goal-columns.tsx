// A goal's bars (2026-11-01, ADR 0067 and 0068: one goal design system): the new
// reviews each week against the plan, or each month against its number. One
// scale, one baseline, the figure at the foot of a bar or on top of it, and the
// bars from before the goal in a quieter ink. A column still counting is dashed,
// as a Portal's Results chart draws its part week. One keyboard stop; pointer,
// touch and keys read the same line under the bars, and the same figures are read
// out as a list, so nothing is carried by height alone. The words are the goal's
// own and arrive finished (`goal-columns-view.ts` works out the heights).
import { useId } from 'react'
import { Check } from 'lucide-react'
import { useBarSelection } from '#/components/hooks/use-bar-selection'
import { cn } from '#/lib/utils'
import { columnsModel, type GoalColumn, type GoalColumnsPlan } from './goal-columns-view'

type Props = Readonly<{
  /** What the bars count, above them. */
  caption: string
  columns: readonly GoalColumn[]
  /** One line across the bars, with its words in the caption's row. */
  plan?: GoalColumnsPlan
  /** Names the keyboard stop: "New reviews; use left and right arrows to inspect each week." */
  label: string
  /** Under the bars until one is chosen. */
  hint: string
}>

/** The plot's height: a new utility class would grow the stylesheet every page loads. */
const PLOT_REM = 10
const PLOT = { height: `${PLOT_REM}rem` } as const
const PAN = { touchAction: 'pan-y' } as const
const PLAN_KEY = { width: '1rem', borderTop: '1.5px solid var(--foreground)' } as const

/** Few bars stay together, at this much a bar, rather than spread across a wide page. */
const FEW_COLUMNS = 5
const COLUMN_REM = 7
const widthOf = (count: number) =>
  count > FEW_COLUMNS ? undefined : { maxWidth: `${count * COLUMN_REM}rem` }

/** How far past the bar a column's own number is marked, each side. */
const MARK_REACH = '-0.3125rem'
const BAR_WIDTH = { width: '56%', maxWidth: '3.25rem' } as const

/** The column's bar, its own number's mark, and its figure. */
function Column({
  column,
  chosen,
  dimmed,
  atFoot,
}: Readonly<{
  column: ReturnType<typeof columnsModel>['columns'][number]
  chosen: boolean
  dimmed: boolean
  atFoot: boolean
}>) {
  const inside = atFoot && column.tall && column.tone === 'since'
  return (
    <div className="flex h-full min-w-0 flex-1 justify-center">
      <div className="relative h-full" style={BAR_WIDTH}>
        <div
          className={cn(
            'absolute inset-x-0 bottom-0 rounded-t-sm',
            column.tone === 'since' && 'bg-chart-1',
            column.tone === 'before' && 'bg-muted-foreground/40',
            column.tone === 'open' && 'border border-dashed bg-muted',
            chosen && column.height > 0 && 'outline-2 outline-offset-2 outline-primary',
          )}
          style={{
            height: `${column.height}%`,
            minHeight: column.height > 0 ? 3 : 0,
            opacity: dimmed ? 0.45 : 1,
            borderColor: column.tone === 'open' ? 'var(--border-control)' : undefined,
          }}
        >
          {column.figure === null ? null : (
            <span
              className={cn(
                'absolute inset-x-0 flex items-center justify-center gap-0.5 text-xs tabular-nums',
                inside
                  ? 'font-semibold text-background'
                  : 'bottom-full pb-1 font-medium text-foreground',
              )}
              style={
                inside
                  ? { bottom: '0.25rem' }
                  : column.figureAboveTick
                    ? {
                        paddingBottom: `calc(${(column.tickGap * PLOT_REM) / 100}rem + 0.375rem)`,
                      }
                    : undefined
              }
            >
              {column.figure}
              {column.met ? <Check aria-hidden="true" className="size-3" /> : null}
            </span>
          )}
        </div>
        {column.tickHeight === null ? null : (
          <span
            aria-hidden="true"
            className="absolute h-0.5 rounded-full bg-foreground"
            style={{
              bottom: `${column.tickHeight}%`,
              left: MARK_REACH,
              right: MARK_REACH,
            }}
          />
        )}
      </div>
    </div>
  )
}

export function GoalColumns({ caption, columns, plan, label, hint }: Props) {
  const id = useId()
  const model = columnsModel(columns, plan)
  const { active, selected, interactionProps } = useBarSelection(model.columns.length)
  if (model.columns.length === 0) return null
  const many = model.columns.length > 7
  return (
    <figure aria-labelledby={id} className="flex flex-col gap-2 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <figcaption id={id} className="text-sm text-muted-foreground">
          {caption}
        </figcaption>
        {plan === undefined ? null : (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium">
            <span aria-hidden="true" className="inline-block" style={PLAN_KEY} />
            {plan.words}
          </span>
        )}
      </div>
      <div
        role="group"
        tabIndex={0}
        aria-label={label}
        aria-describedby={`${id}-value`}
        className="min-w-0 rounded focus-ring"
        style={PAN}
        {...interactionProps}
      >
        <div
          aria-hidden="true"
          className="@container pt-6"
          style={plan === undefined ? widthOf(model.columns.length) : undefined}
        >
          <div className="relative flex items-end gap-1 border-b" style={PLOT}>
            {model.columns.map((column, index) => (
              <Column
                key={column.key}
                column={column}
                chosen={active !== null && index === selected}
                dimmed={active !== null && index !== selected}
                atFoot={plan !== undefined}
              />
            ))}
            {model.plan === null ? null : (
              <span
                className="pointer-events-none absolute right-0"
                style={{
                  left: `${model.plan.left}%`,
                  bottom: `${model.plan.height}%`,
                  borderTop: '2px solid var(--foreground)',
                  zIndex: 1,
                }}
              />
            )}
          </div>
          <div className="mt-1 flex gap-1 text-center text-xs text-muted-foreground">
            {model.columns.map((column, index) => (
              <span key={column.key} className="flex min-w-0 flex-1 justify-center">
                <span
                  className={cn(
                    'shrink-0 whitespace-nowrap',
                    // Every third until the plot has room for them all, so no two ever touch.
                    many &&
                      (model.columns.length - 1 - index) % 3 !== 0 &&
                      'hidden @3xl:flex',
                  )}
                >
                  {column.label}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
      <p
        id={`${id}-value`}
        aria-live="polite"
        className="min-h-5 text-sm text-muted-foreground"
      >
        {active === null ? hint : model.columns[selected]?.line}
      </p>
      <ul className="sr-only" aria-label={caption}>
        {model.columns.map((column) => (
          <li key={column.key}>{column.line}</li>
        ))}
      </ul>
    </figure>
  )
}
