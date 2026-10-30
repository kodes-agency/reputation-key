import { ChangeBadge, Figures } from './guest-voice-figures'
import {
  averagesSpoken,
  changePill,
  starsText,
  type ChangePill,
} from './guest-voice-words'
import type { TopicRow } from '#/contexts/ai/application/public-api'
import { formatNumber } from '#/lib/format'

/**
 * Under this many reviews a topic shows its counts and nothing else: an average of two
 * reviews is an anecdote, and a proportion of two is not a picture.
 */
const TOPIC_MIN_REVIEWS = 3

/** "100 of 128", and the percent beside it once there are 20 reviews to take it of. */
export function ReviewsCell({ row }: Readonly<{ row: TopicRow }>) {
  const { shareText, sharePercent } = row.statistics
  return (
    <span className="text-sm tabular-nums">
      <Figures>{shareText}</Figures>
      {sharePercent === null ? null : (
        <span className="text-muted-foreground">{` · ${sharePercent}%`}</span>
      )}
    </span>
  )
}

/**
 * Praise against complaints, as proportions of the reviews that did either. The bar is
 * a picture of the two counts printed under it, never the only place a difference is
 * shown: its colours are a second cue to the words.
 */
export function PraiseAndComplaintsCell({ row }: Readonly<{ row: TopicRow }>) {
  const { praiseReviews, complaintReviews, neutralReviews } = row
  const total = praiseReviews + complaintReviews
  const showBar = row.statistics.reviewCount >= TOPIC_MIN_REVIEWS && total > 0
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {showBar ? (
        <span
          aria-hidden="true"
          data-slot="topic-bar"
          className="flex h-2 w-full max-w-60 overflow-hidden rounded-full bg-muted"
        >
          <span
            className="bg-positive"
            style={{ width: `${(praiseReviews / total) * 100}%` }}
          />
          <span
            className="bg-destructive"
            style={{ width: `${(complaintReviews / total) * 100}%` }}
          />
        </span>
      ) : null}
      <span className="flex flex-wrap gap-x-3 text-sm tabular-nums">
        <span>{formatNumber(praiseReviews)} praise</span>
        <span>
          {formatNumber(complaintReviews)}{' '}
          {complaintReviews === 1 ? 'complaint' : 'complaints'}
        </span>
        {neutralReviews === 0 ? null : (
          <span className="text-muted-foreground">
            {formatNumber(neutralReviews)} neutral
          </span>
        )}
      </span>
    </div>
  )
}

/** What the reviews that name the topic gave, next to everyone else's. */
export function StarsCell({ row }: Readonly<{ row: TopicRow }>) {
  const { statistics } = row
  const { mentionedAverage, othersAverage } = statistics
  if (statistics.reviewCount < TOPIC_MIN_REVIEWS || mentionedAverage === null) {
    return <span className="text-sm text-muted-foreground">too few</span>
  }
  return (
    <span className="text-sm tabular-nums">
      <span aria-hidden="true">
        {starsText(mentionedAverage)}
        {othersAverage === null ? null : `, the rest ${starsText(othersAverage)}`}
      </span>
      <span className="sr-only">{averagesSpoken(statistics)}</span>
    </span>
  )
}

/** A move the engine calls likely is a pill; steady is a quiet word; no judgement, a dash. */
export function ChangeCell({ row }: Readonly<{ row: TopicRow }>) {
  const { change, evidenceLevel } = row.statistics
  // A topic's rise is a worry only where its complaints are the larger part.
  const sense = row.complaintReviews > row.praiseReviews ? 'complaint' : 'praise'
  const pill: ChangePill | null = changePill(change, evidenceLevel, sense)
  if (pill === null) {
    return (
      <span className="text-sm text-muted-foreground">
        <span aria-hidden="true">—</span>
        <span className="sr-only">No comparison yet</span>
      </span>
    )
  }
  if (change === 'steady') {
    return <span className="text-sm text-muted-foreground">Steady</span>
  }
  return <ChangeBadge pill={pill} />
}
