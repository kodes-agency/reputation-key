// "Over time" (board 07): qualified scans per week as bars, this period beside
// the one before, with the average private rating as a line above and a marker
// where each version went live. The plots are HTML and one SVG line, so every
// position is a percentage (portal-results-chart-model) and nothing is measured
// in the browser. The picture is one named image; its numbers are the table
// below it (portal-results-series-table), where a screen reader reaches them.
import { useId } from 'react'
import { cn } from '#/lib/utils'
import type { ChartColumn, ChartModel } from './portal-results-chart-model'

const AVERAGE_PLOT = 'h-24'
const SCANS_PLOT = 'h-44'

function YAxis({
  labels,
  className,
}: Readonly<{ labels: readonly string[]; className: string }>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'absolute inset-y-0 left-0 flex w-9 flex-col justify-between text-xs text-muted-foreground tabular-nums',
        className,
      )}
    >
      {labels.map((label) => (
        <span key={label} className="-my-2 leading-4">
          {label}
        </span>
      ))}
    </div>
  )
}

/** The average as one line per run of weeks that have one; a gap breaks the line. */
function averagePath(columns: readonly ChartColumn[]): string {
  let path = ''
  let drawing = false
  for (const column of columns) {
    if (column.averageFromTop === null) {
      drawing = false
      continue
    }
    path += `${drawing ? 'L' : 'M'}${column.index + 0.5} ${column.averageFromTop} `
    drawing = true
  }
  return path.trim()
}

/** A week with ratings, too few for an average: a hollow dashed ring where a dot would be. */
function BelowFloorMarker() {
  return (
    <span className="block size-2.5 rounded-full border-2 border-dashed border-muted-foreground bg-background" />
  )
}

function AverageLine({ model }: Readonly<{ model: ChartModel }>) {
  const count = model.columns.length
  const path = averagePath(model.columns)
  return (
    <div className={cn('relative mb-2 ml-10', AVERAGE_PLOT)}>
      <YAxis className="-ml-10" labels={model.average.ticks.map((tick) => `${tick}★`)} />
      {model.average.ticks.map((tick) => (
        <span
          key={tick}
          aria-hidden="true"
          className="absolute inset-x-0 border-t border-dashed border-border"
          style={{
            top: `${((model.average.high - tick) / (model.average.high - model.average.low)) * 100}%`,
          }}
        />
      ))}
      {path === '' ? null : (
        <svg
          aria-hidden="true"
          className="absolute inset-0 size-full overflow-visible"
          viewBox={`0 0 ${count} 100`}
          preserveAspectRatio="none"
        >
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            className="text-foreground"
          />
        </svg>
      )}
      {model.columns.map((column) => (
        <span
          key={column.index}
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${((column.index + 0.5) / count) * 100}%`,
            top: `${column.averageFromTop ?? 50}%`,
          }}
        >
          {column.averageFromTop === null ? (
            column.isBelowFloor ? (
              <BelowFloorMarker />
            ) : null
          ) : (
            <span className="block size-2.5 rounded-full border-2 border-foreground bg-background" />
          )}
        </span>
      ))}
    </div>
  )
}

function ScanBars({ model }: Readonly<{ model: ChartModel }>) {
  const count = model.columns.length
  const topFirst = [...model.scans.ticks].reverse()
  return (
    <div className={cn('relative ml-10', SCANS_PLOT)}>
      <YAxis className="-ml-10" labels={topFirst.map(String)} />
      {model.scans.ticks.map((tick) => (
        <span
          key={tick}
          aria-hidden="true"
          className="absolute inset-x-0 border-t border-dashed border-border"
          style={{ top: `${100 - (tick / model.scans.ceiling) * 100}%` }}
        />
      ))}
      <div
        className="absolute inset-0 grid"
        style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
      >
        {model.columns.map((column) => (
          <div key={column.index} className="flex items-end justify-center gap-1 px-[8%]">
            {column.priorScansPercent === null ? null : (
              <span
                className="w-1/2 rounded-t-sm border-2 border-b-0 border-foreground/50 bg-background"
                style={{ height: `${column.priorScansPercent}%` }}
              />
            )}
            {column.scansPercent === null ? null : (
              <span
                className="w-1/2 rounded-t-sm bg-foreground/75"
                style={{ height: `${column.scansPercent}%` }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function PortalResultsSeriesChart({
  model,
  rangeLabel,
  priorLabel,
  description,
  labelledBy,
}: Readonly<{
  model: ChartModel
  /** The period's name in the legend: "Last 30 days". */
  rangeLabel: string
  /** The period before in the legend: "The 30 days before". */
  priorLabel: string
  description: string
  labelledBy: string
}>) {
  const descriptionId = useId()
  const count = model.columns.length
  return (
    <figure className="min-w-0 space-y-3">
      <figcaption id={descriptionId} className="text-sm text-muted-foreground">
        {description}
      </figcaption>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-[2px] bg-foreground/75" />
          {rangeLabel}
        </li>
        {model.hasPrior ? (
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-[2px] border-2 border-foreground/50"
            />
            {priorLabel}
          </li>
        ) : null}
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full border-2 border-foreground"
          />
          Average private rating
        </li>
        {model.hasBelowFloor ? (
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full border-2 border-dashed border-muted-foreground"
            />
            Too few ratings for an average
          </li>
        ) : null}
        {model.markers.length === 0 ? null : (
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-3 border-l border-primary" />
            Version went live
          </li>
        )}
      </ul>
      <div
        role="img"
        aria-labelledby={labelledBy}
        aria-describedby={descriptionId}
        className="relative space-y-3"
      >
        <p aria-hidden="true" className="text-xs font-medium">
          Average private rating
        </p>
        <AverageLine model={model} />
        <p aria-hidden="true" className="text-xs font-medium">
          Qualified scans per week
        </p>
        <ScanBars model={model} />
        <div
          aria-hidden="true"
          className="ml-10 grid text-xs text-muted-foreground"
          style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
        >
          {model.columns.map((column) =>
            column.labelSpan === null ? null : (
              <span
                key={column.index}
                className={cn(
                  'px-0.5 leading-tight',
                  column.labelSpan === 1 ? 'text-center' : 'text-left',
                )}
                style={{ gridColumn: `${column.index + 1} / span ${column.labelSpan}` }}
              >
                {column.label}
              </span>
            ),
          )}
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 left-10"
        >
          {model.markers.map((marker) => (
            <span
              key={marker.key}
              className="absolute inset-y-6 border-l border-primary"
              style={{ left: `${marker.leftPercent}%` }}
            >
              <span
                className={cn(
                  'absolute -top-5 text-xs whitespace-nowrap text-primary',
                  marker.labelBeforeLine ? 'right-1 text-right' : 'left-1',
                )}
              >
                {marker.label}
              </span>
            </span>
          ))}
        </div>
      </div>
    </figure>
  )
}
