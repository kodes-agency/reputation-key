// How far along a goal is, as a ruler (2026-11-01, ADR 0067 and 0068: one goal
// design system): the setup screen's ruler with the way already climbed filled in.
// Where it started on the left, the goal's number on the right, the stops on the
// way and a label for where the goal stands now. A goal passes finished words and
// shares (`goal-ruler-view.ts` lays them out, pure); it is a picture named by one
// sentence, so a screen reader hears that sentence and not each stop. Nothing
// moves.
import { Check } from 'lucide-react'
import { cn } from '#/lib/utils'
import type { GoalRulerModel, GoalRulerStop } from './goal-ruler-view'

const percent = (share: number): string => `${share * 100}%`

/** Room for the "now" label above the track and the words under it. */
const RULER_ROOM = { paddingTop: '1.75rem', paddingBottom: '2.75rem' } as const
const TRACK_INSET = { boxShadow: 'inset 0 0 0 1px var(--border)' } as const
const RING_REACHED = { boxShadow: '0 0 0 2px var(--primary)' } as const
const RING_AHEAD = { boxShadow: '0 0 0 2px var(--border-control)' } as const
const RING_GOAL = { boxShadow: '0 0 0 3px var(--primary)' } as const
const RING_NOW = { boxShadow: '0 0 0 3px var(--card)' } as const

const NUMBER = 'text-sm leading-tight font-semibold tabular-nums'
const NOTE = 'text-xs leading-tight whitespace-nowrap text-muted-foreground'
const ON_TRACK = 'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full'
/** One-off places and sizes are inline: a new utility class would grow every page's stylesheet. */
const UNDER_TRACK = { top: '0.875rem' } as const
const NOW_SIZE = { width: '1.125rem', height: '1.125rem' } as const
const NOW_LABEL_ABOVE = { bottom: '1.125rem' } as const
const CENTRED = 'translateX(-50%)'
const END_AT = 'translateX(-100%)'

function StopWords({ stop }: Readonly<{ stop: GoalRulerStop }>) {
  if (stop.value === null) return null
  return (
    <span
      className={cn(
        'absolute flex flex-col gap-0.5',
        stop.align === 'end' ? 'items-end' : 'items-center',
      )}
      style={{
        ...UNDER_TRACK,
        left: percent(stop.at),
        transform: stop.align === 'end' ? END_AT : CENTRED,
      }}
    >
      <span className={NUMBER}>{stop.value}</span>
      {stop.note === null ? null : <span className={NOTE}>{stop.note}</span>}
    </span>
  )
}

/** "Today" or "23 so far", above where the goal stands; kept inside the ruler at its ends. */
function NowLabel({ model }: Readonly<{ model: GoalRulerModel }>) {
  return (
    <span
      className="absolute rounded bg-foreground px-1.5 text-xs leading-5 font-semibold whitespace-nowrap text-background"
      style={{
        ...NOW_LABEL_ABOVE,
        left: model.nowAlign === 'start' ? 0 : percent(model.at),
        transform:
          model.nowAlign === 'start'
            ? undefined
            : model.nowAlign === 'end'
              ? END_AT
              : CENTRED,
      }}
    >
      {model.now}
    </span>
  )
}

export function GoalRuler({ model }: Readonly<{ model: GoalRulerModel }>) {
  return (
    <div role="img" aria-label={model.label} data-slot="goal-ruler" className="px-2.5">
      <div style={RULER_ROOM}>
        <div className="relative h-2 rounded-full bg-muted" style={TRACK_INSET}>
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary"
            style={{ width: percent(model.at) }}
          />
          {model.startDot ? (
            <span
              className={cn(ON_TRACK, 'left-0 size-2.5 bg-card')}
              style={RING_REACHED}
            />
          ) : null}
          {model.stops.map((stop) => (
            <span
              key={stop.key}
              className={cn(ON_TRACK, 'size-2.5 bg-card')}
              style={{
                left: percent(stop.at),
                ...(stop.reached ? RING_REACHED : RING_AHEAD),
              }}
            />
          ))}
          {model.reached ? (
            <span
              className={cn(
                ON_TRACK,
                'flex size-5 items-center justify-center bg-positive text-background',
              )}
              style={{ left: '100%' }}
            >
              <Check className="size-3.5" strokeWidth={3} />
            </span>
          ) : (
            <>
              <span
                className={cn(ON_TRACK, 'left-full size-5 bg-card')}
                style={RING_GOAL}
              />
              <span
                className={cn(ON_TRACK, 'bg-foreground')}
                style={{ left: percent(model.at), ...NOW_SIZE, ...RING_NOW }}
              />
            </>
          )}
          {model.reached ? null : <NowLabel model={model} />}
          <span
            className="absolute flex flex-col gap-0.5"
            style={{ ...UNDER_TRACK, left: '-0.625rem' }}
          >
            <span className={NUMBER}>{model.from.value}</span>
            <span className={NOTE}>{model.from.note}</span>
          </span>
          {model.stops.map((stop) => (
            <StopWords key={stop.key} stop={stop} />
          ))}
          <span
            className="absolute flex flex-col items-end gap-0.5"
            style={{ top: '1rem', right: '-0.625rem' }}
          >
            <span className="text-base leading-tight font-semibold text-link tabular-nums">
              {model.to.value}
            </span>
            {model.to.note === null ? null : (
              <span className={cn(NOTE, model.toNoteWideOnly && 'hidden @lg:block')}>
                {model.to.note}
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}
