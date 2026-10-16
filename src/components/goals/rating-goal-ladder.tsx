// The ladder of numbers a Google rating goal climbs (round 5, PLAN-D E6, mocks
// D2/D4): where it started, what Google shows today, a tenth it should show
// soon, the next number, the goal and the one possible after it. Upright beside
// the climb on a wide card, across the top on a narrow one; one `rungs` array
// draws both. It is a picture with its words as its name (`ladderLabel`), so a
// screen reader hears one sentence, not each disc.
import { Check } from 'lucide-react'
import { cn } from '#/lib/utils'
import { ladderLabel, type Rung, type RungTag } from './rating-goal-tracking-words'
import { tenthsText } from './rating-goal-view'

/** Each rung's disc: today filled, the goal ringed, what is ahead dashed. */
const DISC: Readonly<Record<RungTag, string>> = {
  start: 'border-2 border-border bg-card',
  today: 'bg-foreground text-background',
  soon: 'border-2 border-foreground bg-card',
  next: 'border-2 border-dashed border-primary bg-card',
  goal: 'border-2 border-primary bg-card',
  possible: 'border-2 border-dashed border-border bg-card',
}

const NUMBER: Readonly<Record<RungTag, string>> = {
  start: 'text-base text-muted-foreground',
  today: 'text-lg font-semibold',
  soon: 'text-base',
  next: 'text-base',
  goal: 'text-xl font-semibold text-primary',
  possible: 'text-base text-muted-foreground',
}

/** The disc's centre: the line between the discs runs through it (size-8, 32px). */
const DISC_CENTRE_PX = 15

function Disc({ tag }: Readonly<{ tag: RungTag }>) {
  return (
    <span
      className={cn(
        'relative flex size-8 shrink-0 items-center justify-center rounded-full',
        DISC[tag],
      )}
    >
      {tag === 'today' ? <Check className="size-3.5" strokeWidth={3} /> : null}
    </span>
  )
}

const Tag = ({ tag }: Readonly<{ tag: RungTag }>) => (
  <span className="text-xs text-muted-foreground">{tag}</span>
)

/** Upright, the highest number on top, for a card at least 48rem wide. */
function UprightLadder({
  rungs,
  label,
}: Readonly<{ rungs: readonly Rung[]; label: string }>) {
  return (
    <div
      role="img"
      aria-label={label}
      data-slot="rating-goal-ladder"
      className="relative hidden flex-col gap-3 self-center @3xl:flex"
    >
      <span
        className="absolute w-0.5 bg-border"
        style={{ insetInlineStart: DISC_CENTRE_PX, top: 16, bottom: 16 }}
      />
      {[...rungs].reverse().map((rung) => (
        <div key={rung.tag} className="flex items-center gap-3">
          <Disc tag={rung.tag} />
          <span className={cn('tabular-nums', NUMBER[rung.tag])}>
            {tenthsText(rung.tenths)}
          </span>
          <Tag tag={rung.tag} />
        </div>
      ))}
    </div>
  )
}

/** Across, lowest on the left, for a narrower card. */
function AcrossLadder({
  rungs,
  label,
}: Readonly<{ rungs: readonly Rung[]; label: string }>) {
  return (
    <div role="img" aria-label={label} className="flex items-start @3xl:hidden">
      {rungs.map((rung, at) => (
        <div key={rung.tag} className={cn('flex items-start', at > 0 && 'flex-1')}>
          {at > 0 ? (
            <span
              className="mx-2 h-px flex-1 bg-border"
              style={{ marginTop: DISC_CENTRE_PX }}
            />
          ) : null}
          <span className="flex flex-col items-center gap-1">
            <Disc tag={rung.tag} />
            <span className={cn('tabular-nums', NUMBER[rung.tag])}>
              {tenthsText(rung.tenths)}
            </span>
            <Tag tag={rung.tag} />
          </span>
        </div>
      ))}
    </div>
  )
}

export function RatingGoalLadder({
  rungs,
  orientation,
  current,
}: Readonly<{
  rungs: readonly Rung[]
  orientation: 'upright' | 'across'
  /** Whether Google's numbers are current: stale ones are what it showed last. */
  current: boolean
}>) {
  if (rungs.length === 0) return null
  const label = ladderLabel(rungs, { current })
  return orientation === 'upright' ? (
    <UprightLadder rungs={rungs} label={label} />
  ) : (
    <AcrossLadder rungs={rungs} label={label} />
  )
}
