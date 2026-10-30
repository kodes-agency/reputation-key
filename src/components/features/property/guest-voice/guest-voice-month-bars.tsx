import type { GuestVoiceHistoryMonth } from '#/contexts/ai/application/public-api'
import { formatNumber } from '#/lib/format'
import { monthLabel } from './guest-voice-words'

/** The tallest bar, in px; the count above it takes the rest of the column. */
const BAR_AREA_PX = 64

/**
 * The last 12 months of one issue, a bar for the reviews that named it in each. This is
 * how a manager sees whether a fix worked: the bars fall, and the issue goes quiet.
 * The bars and their labels are for the eye; the same figures are read out below them
 * as a list, so nothing is carried by height alone.
 */
export function GuestVoiceMonthBars({
  series,
}: Readonly<{ series: readonly GuestVoiceHistoryMonth[] }>) {
  const peak = Math.max(0, ...series.map((point) => point.reviewCount))
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium">
        Guests who brought it up, each month
      </figcaption>
      <div aria-hidden="true" className="flex flex-col gap-1">
        <div
          className="flex items-end gap-1 border-b"
          style={{ height: BAR_AREA_PX + 20 }}
        >
          {series.map((point) => (
            <div
              key={point.month}
              className="flex flex-1 flex-col items-center justify-end gap-0.5"
            >
              <span className="text-[11px] leading-none text-muted-foreground tabular-nums">
                {point.reviewCount === 0 ? '' : formatNumber(point.reviewCount)}
              </span>
              <span
                className="w-full rounded-t-sm bg-muted-foreground/60"
                style={{
                  height:
                    point.reviewCount === 0
                      ? 0
                      : Math.max(2, Math.round((point.reviewCount / peak) * BAR_AREA_PX)),
                }}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-1 text-[11px] text-muted-foreground">
          {series.map((point) => (
            <span key={point.month} className="flex-1 text-center">
              {monthLabel(point.month).short}
            </span>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Available history: {series.at(0)?.startLocalDate} to {series.at(-1)?.endLocalDate}
        .{' '}
        {series.at(-1)?.partialEnd
          ? `The last month covers through ${series.at(-1)?.endLocalDate}.`
          : null}
        {series.at(0)?.partialStart
          ? ` The first month starts ${series.at(0)?.startLocalDate}.`
          : null}
      </p>
      <ul className="sr-only">
        {series.map((point) => (
          <li key={point.month}>
            {monthLabel(point.month).long}: {formatNumber(point.reviewCount)} of{' '}
            {formatNumber(point.textReviews)} reviews with text · {point.startLocalDate}{' '}
            to {point.endLocalDate}
          </li>
        ))}
      </ul>
    </figure>
  )
}
