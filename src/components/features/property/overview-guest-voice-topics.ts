// Which praise and which complaint Overview's Guest voice row names, and how it
// counts them.
//
// The row used to name the most mentioned of each. A topic mentioned most is not
// the one that costs the most: parking can be named in ten reviews that gave five
// stars and a broken lift in four that gave one. The complaint it names is now the
// one with the most stars at stake (`stars.upTo`, the share of reviews times how
// far below the rest they rate), and a count is a count of reviews: "Staff, 11 of
// 40 reviews".
import type { AiAspectAggregate } from '#/contexts/ai/application/public-api'
import { formatNumber } from '#/lib/format'
import { ASPECT_LABELS } from '#/shared/aspect-labels'

function byPraise(left: AiAspectAggregate, right: AiAspectAggregate): number {
  return (
    right.reviewCount - left.reviewCount ||
    right.mentionCount - left.mentionCount ||
    ASPECT_LABELS[left.aspect].localeCompare(ASPECT_LABELS[right.aspect])
  )
}

/** A complaint too few reviews make (`upTo` unknown) ranks after one that was weighed. */
function byStarsAtStake(left: AiAspectAggregate, right: AiAspectAggregate): number {
  return (right.stars.upTo ?? -1) - (left.stars.upTo ?? -1) || byPraise(left, right)
}

function best(
  aspects: readonly AiAspectAggregate[],
  polarity: AiAspectAggregate['polarity'],
  compare: (left: AiAspectAggregate, right: AiAspectAggregate) => number,
): AiAspectAggregate | undefined {
  return aspects
    .filter((entry) => entry.polarity === polarity && entry.reviewCount > 0)
    .sort(compare)[0]
}

/** The topic most reviews praise. */
export function topPraise(
  aspects: readonly AiAspectAggregate[],
): AiAspectAggregate | undefined {
  return best(aspects, 'positive', byPraise)
}

/** The topic whose complaints put the most stars at stake, not the one named most. */
export function topComplaint(
  aspects: readonly AiAspectAggregate[],
): AiAspectAggregate | undefined {
  return best(aspects, 'negative', byStarsAtStake)
}

/** "Staff, 11 of 40 reviews": reviews that name the topic, of the reviews read for topics. */
export function topicCountText(entry: AiAspectAggregate, readForTopics: number): string {
  const reviews = readForTopics === 1 ? 'review' : 'reviews'
  return `${ASPECT_LABELS[entry.aspect]}, ${formatNumber(entry.reviewCount)} of ${formatNumber(readForTopics)} ${reviews}`
}
