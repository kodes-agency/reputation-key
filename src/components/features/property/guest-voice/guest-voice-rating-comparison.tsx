import { reviewsPhrase } from './guest-voice-words'
import type { IssueDrawer } from '#/contexts/ai/application/public-api'

export function GuestVoiceRatingComparison({
  comparison,
}: Readonly<{ comparison: IssueDrawer['commentComparison'] }>) {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm text-muted-foreground">
        Guests who left an analysed comment
      </figcaption>
      <div
        aria-hidden="true"
        className="flex justify-between text-sm text-muted-foreground"
        style={{ marginInlineStart: '6.5rem' }}
      >
        <span>1★</span>
        <span>5★</span>
      </div>
      {(
        [
          ['These guests', comparison.mentionedAverage, comparison.mentionedCount],
          ['Other guests', comparison.othersAverage, comparison.otherCount],
        ] as const
      ).map(([label, average, count], index) => (
        <div key={label} className="flex items-center gap-2 text-sm">
          <span className="w-24 shrink-0">
            {label}
            <span className="sr-only">
              : {average === null ? 'Not available' : `${average.toFixed(1)} stars`} ·{' '}
              {reviewsPhrase(count)}
            </span>
          </span>
          <span
            aria-hidden="true"
            className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
          >
            <span
              className={
                index === 0
                  ? 'block h-full rounded-full bg-warn'
                  : 'block h-full rounded-full bg-muted-foreground'
              }
              style={{ width: average === null ? 0 : `${((average - 1) / 4) * 100}%` }}
            />
          </span>
          <strong aria-hidden="true" className="w-12 text-right font-semibold">
            {average === null ? '—' : `${average.toFixed(1)}★`}
          </strong>
        </div>
      ))}
      {comparison.mentionedAverage === null || comparison.othersAverage === null ? (
        <p className="text-sm text-muted-foreground">— Not available</p>
      ) : null}
    </figure>
  )
}
