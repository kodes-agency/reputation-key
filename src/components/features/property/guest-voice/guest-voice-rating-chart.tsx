import { useId, useState } from 'react'
import type { GuestVoiceRatingMonth } from '#/contexts/ai/application/public-api'
import { partialMonthText } from './guest-voice-check-in-words'
import { monthLabel, starsText } from './guest-voice-words'

/** One read-only keyboard stop, with the same selected value for pointer and keyboard. */
export function GuestVoiceRatingChart({
  months,
}: Readonly<{ months: readonly GuestVoiceRatingMonth[] }>) {
  const id = useId()
  const [selected, setSelected] = useState(Math.max(0, months.length - 1))
  const point = months[selected]
  return (
    <figure aria-labelledby={id} className="flex flex-col gap-2 py-2">
      <figcaption id={id} className="text-sm text-muted-foreground">
        Average stars each month · 1–5 stars
      </figcaption>
      <div
        role="group"
        tabIndex={0}
        aria-label="Monthly ratings; use left and right arrows to inspect months."
        aria-describedby={`${id}-value`}
        className="rounded focus-ring"
        onKeyDown={(event) => {
          const next = {
            ArrowLeft: Math.max(0, selected - 1),
            ArrowRight: Math.min(months.length - 1, selected + 1),
            Home: 0,
            End: months.length - 1,
          }[event.key]
          if (next !== undefined) {
            event.preventDefault()
            setSelected(Math.max(0, next))
          }
        }}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          setSelected(
            Math.min(
              months.length - 1,
              Math.max(
                0,
                Math.floor(((event.clientX - box.left) / box.width) * months.length),
              ),
            ),
          )
        }}
      >
        <div aria-hidden="true" className="flex h-32 items-end gap-2 border-b">
          {months.map((month, index) => (
            <span
              key={month.month}
              className={`flex min-w-0 flex-1 rounded-t-sm ${index === selected ? 'bg-positive' : 'bg-muted-foreground/60'} ${month.partialEnd || month.partialStart ? 'border border-dashed opacity-60' : ''}`}
              style={{
                height:
                  month.averageStars === null
                    ? 0
                    : `${((month.averageStars - 1) / 4) * 100}%`,
              }}
            />
          ))}
        </div>
        <div aria-hidden="true" className="flex gap-2 text-xs text-muted-foreground">
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
              </span>
            </span>
          ))}
        </div>
      </div>
      <p id={`${id}-value`} aria-live="polite" className="text-xs text-muted-foreground">
        {point
          ? `${partialMonthText(point)} · ${point.averageStars === null ? 'No average' : starsText(point.averageStars)}`
          : 'No monthly ratings available.'}
      </p>
      <ul className="sr-only" aria-label="Monthly comment ratings">
        {months.map((month) => (
          <li key={month.month}>
            {monthLabel(month.month).long} · {month.startLocalDate} to{' '}
            {month.endLocalDate}: {month.reviewCount} reviews ·{' '}
            {month.averageStars === null
              ? 'Not available'
              : `${month.averageStars.toFixed(1)} stars`}
          </li>
        ))}
      </ul>
    </figure>
  )
}
