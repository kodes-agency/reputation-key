import { useId } from 'react'
import type {
  PortalResultsSeries,
  PortalVersionMarker,
} from '#/contexts/reporting/application/public-api'
import { useBarSelection } from '#/components/hooks/use-bar-selection'
import { cn } from '#/lib/utils'
import {
  COLUMNS_THAT_ALL_PRINT_THEIR_COUNT,
  trendModel,
} from './portal-results-trend-model'

/** A single scan scale, one baseline, and separate rows for updates and dates. */
export function PortalResultsTrend({
  series,
  markers,
}: Readonly<{
  series: PortalResultsSeries
  markers: readonly PortalVersionMarker[]
}>) {
  const id = useId()
  const model = trendModel(series, markers)
  const { active, selected, interactionProps } = useBarSelection(
    model?.columns.length ?? 0,
  )
  if (!model) return null
  const { columns } = model
  const many = columns.length > COLUMNS_THAT_ALL_PRINT_THEIR_COUNT
  return (
    <figure aria-labelledby={id} className="flex flex-col gap-2 py-2">
      <figcaption id={id} className="text-sm text-muted-foreground">
        Scans {series.bucketDays === 1 ? 'each day' : 'each week'}
      </figcaption>
      <div
        role="group"
        tabIndex={0}
        aria-label="Scans; use left and right arrows to inspect days and weeks."
        aria-describedby={`${id}-value`}
        className="min-w-0 rounded focus-ring"
        style={{ touchAction: 'pan-y' }}
        {...interactionProps}
      >
        <div aria-hidden="true" className="pt-6">
          <div className="flex h-32 items-end gap-2 border-b">
            {columns.map((column, index) => (
              <div
                key={column.index}
                className="flex h-full min-w-0 flex-1 items-end justify-center"
              >
                <div
                  data-bucket={column.index}
                  className={cn(
                    'relative w-full max-w-14 rounded-t-sm bg-chart-1',
                    column.partial &&
                      column.scans > 0 &&
                      'border border-dashed border-muted-foreground bg-muted',
                    active !== null &&
                      index === selected &&
                      column.scans > 0 &&
                      'outline-2 outline-offset-2 outline-primary',
                  )}
                  style={{
                    height: `${column.height}%`,
                    minHeight: column.scans > 0 ? 3 : 0,
                    opacity: active !== null && index !== selected ? 0.45 : 1,
                  }}
                >
                  {column.countLabel ? (
                    <span className="absolute inset-x-0 bottom-full pb-1 text-center text-xs text-foreground tabular-nums">
                      {column.countLabel}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <div className="flex h-4 items-center gap-2">
            {columns.map((column) => (
              <span key={column.index} className="flex min-w-0 flex-1 justify-center">
                {column.updated ? (
                  <span className="size-1.5 rounded-full bg-primary" />
                ) : null}
              </span>
            ))}
          </div>
          <div
            className={cn(
              'flex gap-2 text-center text-muted-foreground',
              many ? 'text-xs' : 'text-sm',
            )}
          >
            {columns.map((column, index) => (
              <span key={column.index} className="flex min-w-0 flex-1 justify-center">
                <span
                  className={cn(
                    'shrink-0 whitespace-nowrap',
                    // Every third until the plot has room for them all, so no two ever touch.
                    many &&
                      index % 3 !== 0 &&
                      index !== columns.length - 1 &&
                      'hidden @5xl:inline',
                  )}
                >
                  {column.dateLabel}
                  {column.dayLabel ? (
                    <>
                      <br />
                      {column.dayLabel}
                    </>
                  ) : null}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
      {model.partialCaption ? (
        <p className="text-sm text-muted-foreground">{model.partialCaption}</p>
      ) : null}
      {model.updates ? (
        <p className="text-sm text-muted-foreground">{model.updates}</p>
      ) : null}
      <p
        id={`${id}-value`}
        aria-live="polite"
        className="min-h-5 text-sm text-muted-foreground"
      >
        {active === null
          ? many && 'Hover or tap a bar to see its number.'
          : columns[selected]?.valueLine}
      </p>
      <ul className="sr-only" aria-label="Scans by day and week">
        {columns.map((column) => (
          <li key={column.index}>{column.valueLine}</li>
        ))}
      </ul>
    </figure>
  )
}
