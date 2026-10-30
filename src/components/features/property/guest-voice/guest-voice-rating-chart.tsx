import { useId, useState, type PointerEvent } from 'react'
import type { GuestVoiceRatingMonth } from '#/contexts/ai/application/public-api'
import { TONE_INK, type Tone } from '#/components/ui/tone'
import { formatLocalDate } from '#/lib/format'
import { cn } from '#/lib/utils'
import { partialMonthText } from './guest-voice-check-in-words'
import { monthLabel, starsText, reviewsPhrase } from './guest-voice-words'

/** One read-only keyboard stop; touch, pointer and keys share the selected month. */
export function GuestVoiceRatingChart({
  months: allMonths,
  recentStart,
  tone = 'neutral',
}: Readonly<{
  months: readonly GuestVoiceRatingMonth[]
  recentStart?: string
  tone?: Tone
}>) {
  const months = allMonths.filter(
    (month, index) => index !== 0 || !month.partialStart || month.reviewCount > 0,
  )
  const id = useId()
  const [active, setActive] = useState<number | null>(null)
  const selected = Math.min(active ?? months.length - 1, months.length - 1)
  const point = months[selected]
  const selectPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    setActive(
      Math.min(
        months.length - 1,
        Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * months.length)),
      ),
    )
  }
  return (
    <figure aria-labelledby={id} className="flex flex-col gap-2 py-2">
      <figcaption id={id} className="text-sm text-muted-foreground">
        Average stars each month · 1–5 stars
      </figcaption>
      <div className="flex gap-2">
        <div
          aria-hidden="true"
          className="flex h-32 flex-col justify-between text-sm text-muted-foreground"
        >
          <span>5★</span>
          <span>3★</span>
          <span>1★</span>
        </div>
        <div
          role="group"
          tabIndex={0}
          aria-label="Monthly ratings; use left and right arrows to inspect months."
          aria-describedby={`${id}-value`}
          className="min-w-0 flex-1 rounded focus-ring"
          style={{ touchAction: 'pan-y' }}
          onKeyDown={(event) => {
            const next = {
              ArrowLeft: Math.max(0, selected - 1),
              ArrowRight: Math.min(months.length - 1, selected + 1),
              Home: 0,
              End: months.length - 1,
            }[event.key]
            if (next !== undefined) {
              event.preventDefault()
              setActive(Math.max(0, next))
            }
          }}
          onPointerDown={selectPointer}
          onPointerMove={selectPointer}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
        >
          <div aria-hidden="true" className="relative flex h-32 items-end gap-2 border-b">
            <span className="pointer-events-none absolute inset-x-0 top-0 border-t border-border/50" />
            <span className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-border/50" />
            {months.map((month, index) => (
              <span
                key={month.month}
                data-month={month.month}
                data-recent={
                  recentStart !== undefined && month.endLocalDate >= recentStart
                }
                className={cn(
                  'z-10 flex min-w-0 flex-1 rounded-t-sm bg-muted-foreground/60',
                  recentStart !== undefined &&
                    month.endLocalDate >= recentStart &&
                    `${TONE_INK[tone]} bg-current`,
                  (month.partialEnd || month.partialStart) &&
                    'border border-dashed border-muted-foreground bg-muted',
                  active !== null &&
                    index === selected &&
                    'outline-2 outline-offset-2 outline-primary',
                )}
                style={{
                  opacity: active !== null && index !== selected ? 0.45 : 1,
                  height:
                    month.averageStars === null
                      ? 0
                      : `${((month.averageStars - 1) / 4) * 100}%`,
                }}
              />
            ))}
          </div>
          <div aria-hidden="true" className="flex gap-2 text-sm text-muted-foreground">
            {months.map((month, index) => (
              <span key={month.month} className="min-w-0 flex-1 text-center">
                <span
                  className={
                    index % 3 !== 0 && index !== months.length - 1
                      ? 'hidden md:inline'
                      : undefined
                  }
                >
                  {monthLabel(month.month).short}
                  {month.partialStart ? ` '${month.month.slice(2, 4)}` : ''}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
      {recentStart ? (
        <p className="text-sm text-muted-foreground">
          <span className={TONE_INK[tone]}>
            Since {formatLocalDate(recentStart, { year: false })}
          </span>{' '}
          · earlier months in grey · dashed months cover part of a month
        </p>
      ) : null}
      <p id={`${id}-value`} aria-live="polite" className="text-sm text-muted-foreground">
        {point ? (
          <>
            {partialMonthText(point)} ·{' '}
            <span aria-hidden="true">
              {point.averageStars === null ? 'No average' : starsText(point.averageStars)}
            </span>
            <span className="sr-only">
              {point.averageStars === null
                ? 'No average'
                : `${point.averageStars.toFixed(1)} stars`}
            </span>
          </>
        ) : (
          'No monthly ratings available.'
        )}
      </p>
      <ul className="sr-only" aria-label="Monthly comment ratings">
        {months.map((month) => (
          <li key={month.month}>
            {monthLabel(month.month).long} · {formatLocalDate(month.startLocalDate)} to{' '}
            {formatLocalDate(month.endLocalDate)}: {reviewsPhrase(month.reviewCount)} ·{' '}
            {month.averageStars === null
              ? 'Not available'
              : `${month.averageStars.toFixed(1)} stars`}
          </li>
        ))}
      </ul>
    </figure>
  )
}
