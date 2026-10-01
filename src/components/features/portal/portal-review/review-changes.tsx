// "What guests will see change": every change since the live version, in plain
// words, each with who made it and when, and "Show" to bring it into view in
// the phones. A portal that is not live has no list: nothing is public yet, so
// the heading says what publishing does instead.

import { Eye, FileText, LayoutGrid, Palette, Settings2, Type } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import type { PortalReview } from '#/contexts/portal/application/public-api'
import { formatHistoryTime } from '../portal-history/portal-history-time'
import { PhraseView } from '../portal-history/portal-phrase-view'
import { phraseText } from '../portal-history/portal-history-phrase'
import {
  describeReviewChange,
  type ReviewChangeGlyph,
  type ReviewChangeLine,
} from './portal-review-changes'

const GLYPH = {
  linktree: LayoutGrid,
  text: Type,
  look: Palette,
  settings: Settings2,
  page: FileText,
} as const satisfies Record<ReviewChangeGlyph, unknown>

type Props = Readonly<{
  review: Pick<PortalReview, 'changes' | 'changesMayBeIncomplete' | 'action' | 'live'>
  now: Date
  timeZone: string
  /** The change "Show" last brought into view. */
  shownId: string | null
  onShow: (line: ReviewChangeLine) => void
}>

export function ReviewChanges({ review, now, timeZone, shownId, onShow }: Props) {
  const { changes, live } = review
  if (live === null) return <NotLive />
  const lines = changes.map(describeReviewChange)
  return (
    <section aria-labelledby="review-changes-heading" className="space-y-3">
      <h2
        id="review-changes-heading"
        className="flex items-baseline gap-2 text-lg font-semibold"
      >
        What guests will see change
        {lines.length === 0 ? null : (
          <span className="text-sm font-normal text-muted-foreground">
            {lines.length}
          </span>
        )}
      </h2>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing has changed since version {live.version}.
        </p>
      ) : (
        <ul className="divide-y border-y">
          {lines.map((line) => (
            <ChangeRow
              key={line.id}
              line={line}
              now={now}
              timeZone={timeZone}
              isShown={line.id === shownId}
              onShow={onShow}
            />
          ))}
        </ul>
      )}
      {review.changesMayBeIncomplete ? (
        <p className="text-xs text-muted-foreground">
          Only the newest changes are listed. Older ones are published too.
        </p>
      ) : null}
    </section>
  )
}

function NotLive() {
  return (
    <section aria-labelledby="review-changes-heading" className="space-y-2">
      <h2 id="review-changes-heading" className="text-lg font-semibold">
        What guests will see
      </h2>
      <p className="text-sm text-muted-foreground">
        Nothing is public yet. Publishing opens the page on the right to guests who use
        this portal’s code.
      </p>
    </section>
  )
}

function ChangeRow({
  line,
  now,
  timeZone,
  isShown,
  onShow,
}: Readonly<{
  line: ReviewChangeLine
  now: Date
  timeZone: string
  isShown: boolean
  onShow: (line: ReviewChangeLine) => void
}>) {
  const Glyph = GLYPH[line.glyph]
  const time = line.at === null ? null : formatHistoryTime(line.at, now, timeZone)
  return (
    <li className="flex items-start gap-3 py-3">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-card text-muted-foreground"
      >
        <Glyph className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5 text-sm">
        <p className="text-foreground">
          <PhraseView phrase={line.headline} />
        </p>
        {line.detail === null ? null : (
          <p className="text-muted-foreground">
            <PhraseView phrase={line.detail} />
          </p>
        )}
        {line.actor === null && time === null ? null : (
          <p className="text-xs text-muted-foreground">
            {line.actor}
            {line.actor !== null && time !== null ? ' · ' : null}
            {time === null ? null : (
              <time dateTime={time.dateTime} title={time.title}>
                {time.label}
              </time>
            )}
          </p>
        )}
      </div>
      {line.part === null ? null : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={isShown}
          aria-label={`Show on the page: ${phraseText(line.headline)}`}
          className={cn(
            'shrink-0 text-muted-foreground',
            isShown && 'bg-accent text-foreground',
          )}
          onClick={() => onShow(line)}
        >
          <Eye aria-hidden="true" />
          Show
        </Button>
      )}
    </li>
  )
}
