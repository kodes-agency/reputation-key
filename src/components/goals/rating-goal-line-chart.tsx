// "Your rating on Google" (2026-11-01, ADR 0067; `rating-goal-line-chart-view.ts`
// works it out): an SVG stretched over the plot for the lines, and plain elements
// for the words and the dots, so the text never stretches with it and the chart
// needs no measuring and no chart library. The figure's name and caption are its
// text alternative, and each point is read out as a list. One keyboard stop;
// pointer, touch and keys choose the same point, whose line is under the chart.
import { useId } from 'react'
import { useBarSelection } from '#/components/hooks/use-bar-selection'
import { cn } from '#/lib/utils'
import type { LineChartModel, LineChartWords } from './rating-goal-line-chart-view'

/** The plot's height and the axis column: new utility classes would grow every page's stylesheet. */
const PLOT = { height: '14rem' } as const
const COLUMNS = { gridTemplateColumns: '1.75rem minmax(0,1fr)' } as const
const PAN = { touchAction: 'pan-y' } as const
const STRETCH = 'non-scaling-stroke'

const WORDS = 'absolute whitespace-nowrap text-xs'
const RING = { boxShadow: '0 0 0 2px var(--card)' } as const

/** Words beside a point: above or under it, to its left or right. */
function PointWords({
  place,
  className,
}: Readonly<{ place: LineChartWords; className: string }>) {
  const x = place.side === 'left' ? 'calc(-100% - 0.375rem)' : '0.375rem'
  const y = place.above ? 'calc(-100% - 0.375rem)' : '0.5rem'
  return (
    <span
      className={cn(WORDS, className)}
      style={{
        left: `${place.x}%`,
        top: `${place.y}%`,
        transform: `translate(${x}, ${y})`,
      }}
    >
      {place.words}
    </span>
  )
}

function Dot({
  x,
  y,
  size,
  className,
  style,
}: Readonly<{
  x: number
  y: number
  size: string
  className: string
  style?: React.CSSProperties
}>) {
  return (
    <span
      className={cn(
        'absolute -translate-x-1/2 -translate-y-1/2 rounded-full',
        size,
        className,
      )}
      style={{ left: `${x}%`, top: `${y}%`, ...style }}
    />
  )
}

function Lines({
  model,
  chosenX,
}: Readonly<{ model: LineChartModel; chosenX: number | null }>) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="absolute inset-0 size-full overflow-visible"
      fill="none"
    >
      {model.grid.map((line) => (
        <line
          key={line.y}
          x1="0"
          x2="100"
          y1={line.y}
          y2={line.y}
          stroke="var(--border)"
          vectorEffect={STRETCH}
        />
      ))}
      <line
        x1="0"
        x2="100"
        y1="100"
        y2="100"
        stroke="var(--border)"
        vectorEffect={STRETCH}
      />
      {model.wash === null ? null : (
        <path d={model.wash} fill="var(--primary)" fillOpacity={0.07} />
      )}
      <line
        x1="0"
        x2="100"
        y1={model.goalY}
        y2={model.goalY}
        stroke="var(--primary)"
        strokeWidth={1.5}
        vectorEffect={STRETCH}
      />
      {model.before === null ? null : (
        <path
          d={model.before}
          stroke="var(--border-control)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect={STRETCH}
        />
      )}
      {model.ahead === null ? null : (
        <path
          d={model.ahead}
          stroke="var(--primary)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray="1 6"
          vectorEffect={STRETCH}
        />
      )}
      <path
        d={model.since}
        stroke="var(--primary)"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect={STRETCH}
      />
      {chosenX === null ? null : (
        <line
          x1={chosenX}
          x2={chosenX}
          y1="0"
          y2="100"
          stroke="var(--border-control)"
          vectorEffect={STRETCH}
        />
      )}
    </svg>
  )
}

export function RatingGoalLineChart({ model }: Readonly<{ model: LineChartModel }>) {
  const id = useId()
  const { active, selected, interactionProps } = useBarSelection(model.stops.length)
  const chosen = active === null ? null : (model.stops[selected] ?? null)
  return (
    <figure
      aria-labelledby={id}
      aria-describedby={`${id}-sentence`}
      data-slot="rating-goal-line-chart"
      className="@container flex flex-col gap-2 py-2"
    >
      <figcaption id={id} className="text-sm text-muted-foreground">
        Your rating on Google
      </figcaption>
      <p id={`${id}-sentence`} className="sr-only">
        {model.sentence}
      </p>
      <div className="grid pt-5" style={COLUMNS}>
        <div aria-hidden="true" className="relative" style={PLOT}>
          {model.grid.map((line) =>
            line.label === null ? null : (
              <span
                key={line.y}
                className="absolute left-0 -translate-y-1/2 text-xs text-muted-foreground tabular-nums"
                style={{ top: `${line.y}%` }}
              >
                {line.label}
              </span>
            ),
          )}
          <span
            className="absolute left-0 -translate-y-1/2 text-sm font-bold text-link tabular-nums"
            style={{ top: `${model.goalY}%` }}
          >
            {model.goalLabel}
          </span>
        </div>
        <div className="relative" style={PLOT}>
          <div aria-hidden="true" className="absolute inset-0">
            <Lines model={model} chosenX={chosen?.x ?? null} />
            <span
              className={cn(WORDS, 'left-0 pb-1 font-semibold text-link')}
              style={{ top: `${model.goalY}%`, transform: 'translateY(-100%)' }}
            >
              Your goal
            </span>
            {model.aheadWords === null ? null : (
              <span
                className={cn(WORDS, 'right-0 pb-1 font-semibold')}
                style={{ top: `${model.goalY}%`, transform: 'translateY(-100%)' }}
              >
                {model.aheadWords}
              </span>
            )}
            {model.arrival === null ? null : (
              <Dot
                x={model.arrival.x}
                y={model.arrival.y}
                size="size-2.5"
                className="border-2 border-primary bg-card"
              />
            )}
            {model.set === null ? null : (
              <>
                <Dot
                  x={model.set.x}
                  y={model.set.y}
                  size="size-2.5"
                  className="border-2 border-border-control bg-card"
                />
                {model.set.named ? (
                  <PointWords
                    place={model.set}
                    className="hidden text-muted-foreground @lg:block"
                  />
                ) : null}
              </>
            )}
            {model.moves.map((move) => (
              <span key={move.key}>
                <Dot
                  x={move.x}
                  y={move.y}
                  size="size-2.5"
                  className={move.up ? 'bg-positive' : 'bg-warn'}
                  style={RING}
                />
                {move.words === null ? null : (
                  <PointWords
                    place={move.words}
                    className="hidden font-medium @lg:block"
                  />
                )}
              </span>
            ))}
            <Dot
              x={model.today.x}
              y={model.today.y}
              size="size-3"
              className="bg-primary"
              style={RING}
            />
            <PointWords place={model.today} className="font-bold" />
            {chosen === null ? null : (
              <Dot
                x={chosen.x}
                y={chosen.y}
                size="size-2.5"
                className="bg-foreground"
                style={RING}
              />
            )}
          </div>
          {/* Where the pointer and the keys choose a point: the line's own width. */}
          <div
            role="group"
            tabIndex={0}
            aria-label="Your rating over time; use left and right arrows to read each week."
            aria-describedby={`${id}-value`}
            className="absolute inset-y-0 left-0 rounded focus-ring"
            style={{ ...PAN, width: `${model.pastWidth}%` }}
            {...interactionProps}
          />
        </div>
        <div />
        <div aria-hidden="true" className="relative h-5">
          {model.months.map((month) => (
            <span
              key={month.x}
              className="absolute top-1 -translate-x-1/2 text-xs text-muted-foreground"
              style={{ left: `${month.x}%` }}
            >
              {month.label}
            </span>
          ))}
        </div>
      </div>
      <p
        id={`${id}-value`}
        aria-live="polite"
        className="min-h-5 text-sm text-muted-foreground"
      >
        {chosen?.line ?? 'Hover or tap the line to read a week.'}
      </p>
      <ul className="sr-only" aria-label="Your rating over time">
        {model.stops.map((stop) => (
          <li key={stop.key}>{stop.line}</li>
        ))}
      </ul>
    </figure>
  )
}
