// The sections of the Guest voice 2.0 page, each a plain function of the counted
// reviews: what to fix first, what to watch, what guests love, what changed, and every
// topic. The rules here are the agreed ones (decisions Q1, Q6, Q7): a problem named in
// three or more reviews is ranked by the stars it could be costing; one or two is a
// quiet count; praise is protected; a move is reported only when the engine calls it
// likely. Every figure is `issueStatistics`' (the engine's), so a page cannot print a
// number the engine would not.
import { REVIEW_TOPIC_LABELS_V3, REVIEW_TOPICS_V3 } from '#/shared/review-topic-taxonomy'
import type { ReviewTopicV3 } from '#/shared/review-topic-taxonomy'
import type {
  ChangedItem,
  FixFirstItem,
  GuestsLoveItem,
  IssueStatistics,
  TopicRow,
  WatchItem,
} from './guest-voice-v2'
import type {
  GuestVoiceIssueGroup,
  GuestVoiceMention,
  GuestVoiceReview,
} from './guest-voice-v2-facts'
import { senseOf } from './guest-voice-v2-facts'
import { issueStatistics, type WindowFacts } from './issue-statistics'
import {
  countIssueReviews,
  countTopicReviews,
  issueSenseKey,
  tallyIssues,
  tallyTopics,
  type IssueTally,
} from './guest-voice-v2-tally'

/** A problem is ranked on Fix first from this many reviews; fewer is on the Watch list. */
const FIX_FIRST_MIN_REVIEWS = 3
/** Praise is reported from this many reviews. */
const GUESTS_LOVE_MIN_REVIEWS = 3
/** The lists are a guide, not a table: "Every topic" holds the rest. */
const MAX_FIX_FIRST = 8
const MAX_GUESTS_LOVE = 5
const MAX_WATCH = 12
const MAX_WHAT_CHANGED = 6
/** How many causes a card names. */
export const MAX_CAUSES = 4

/** The counted reviews of one read, and what the engine is given to work figures out. */
export type SectionInput = Readonly<{
  windowFacts: WindowFacts
  groups: ReadonlyMap<string, GuestVoiceIssueGroup>
  current: readonly GuestVoiceReview[]
  baseline: readonly GuestVoiceReview[]
}>

export type CountedReviews = Readonly<{
  issues: ReadonlyMap<string, IssueTally>
  precedingIssues: ReadonlyMap<string, number>
}>

export function countReviews(input: SectionInput): CountedReviews {
  return {
    issues: tallyIssues(input.current),
    precedingIssues: countIssueReviews(input.baseline),
  }
}

/** "air conditioning" as a title or a chip: its first letter in capitals. */
function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** An issue's name: what a manager called it, else the thing, else the topic itself. */
export function issueTitle(group: GuestVoiceIssueGroup): string {
  if (group.displayName !== null) return group.displayName
  return group.canonicalThing === null
    ? REVIEW_TOPIC_LABELS_V3[group.topic]
    : capitalized(group.canonicalThing)
}

export function statisticsOfIssue(
  input: SectionInput,
  counted: CountedReviews,
  tally: IssueTally,
): IssueStatistics {
  return issueStatistics(input.windowFacts, {
    stars: tally.stars,
    before: counted.precedingIssues.get(issueSenseKey(tally.groupId, tally.sense)) ?? 0,
  })
}

function mentionsOfIssue(
  review: GuestVoiceReview,
  tally: IssueTally,
): readonly GuestVoiceMention[] {
  return review.mentions.filter(
    (mention) =>
      mention.issueGroupId === tally.groupId && senseOf(mention.polarity) === tally.sense,
  )
}

/** The causes named most often in the reviews of an issue, each counted once per review. */
export function topCauses(tally: IssueTally, limit: number): readonly string[] {
  const counts = new Map<string, number>()
  for (const review of tally.reviews) {
    const causes = new Set<string>()
    for (const mention of mentionsOfIssue(review, tally)) {
      if (mention.cause !== null) causes.add(mention.cause)
    }
    for (const cause of causes) counts.set(cause, (counts.get(cause) ?? 0) + 1)
  }
  return [...counts]
    .sort(
      ([left, leftCount], [right, rightCount]) =>
        rightCount - leftCount || left.localeCompare(right),
    )
    .slice(0, limit)
    .map(([cause]) => capitalized(cause))
}

/** The tallies of one sense, with the issues a manager has hidden left out. */
function visibleTallies(
  input: SectionInput,
  counted: CountedReviews,
  sense: IssueTally['sense'],
): readonly Readonly<{ tally: IssueTally; group: GuestVoiceIssueGroup }>[] {
  const visible: Array<Readonly<{ tally: IssueTally; group: GuestVoiceIssueGroup }>> = []
  for (const tally of counted.issues.values()) {
    const group = input.groups.get(tally.groupId)
    if (tally.sense !== sense || group === undefined || group.hidden) continue
    visible.push({ tally, group })
  }
  return visible
}

function byIssueIdThen(left: string, right: string): number {
  return left.localeCompare(right)
}

/** Urgent first, then the most stars at stake, then the most reviews, then a stable order. */
function byFixFirstOrder(left: FixFirstItem, right: FixFirstItem): number {
  return (
    Number(right.urgentReason !== null) - Number(left.urgentReason !== null) ||
    (right.statistics.upTo ?? 0) - (left.statistics.upTo ?? 0) ||
    right.statistics.reviewCount - left.statistics.reviewCount ||
    byIssueIdThen(left.issueId, right.issueId)
  )
}

/** The most severe Urgent reason among reviews, in the order the guide lists them. */
export function mostSevereUrgentReason(
  reviews: readonly GuestVoiceReview[],
): FixFirstItem['urgentReason'] {
  for (const reason of ['safety', 'health', 'discrimination', 'legal_threat'] as const) {
    if (reviews.some((review) => review.urgentReason === reason)) return reason
  }
  return null
}

export function fixFirstItems(
  input: SectionInput,
  counted: CountedReviews,
): readonly FixFirstItem[] {
  return visibleTallies(input, counted, 'complaint')
    .filter(({ tally }) => tally.reviews.length >= FIX_FIRST_MIN_REVIEWS)
    .map(({ tally, group }) => ({
      issueId: group.id,
      title: issueTitle(group),
      topic: group.topic,
      causes: topCauses(tally, MAX_CAUSES),
      urgentReason: mostSevereUrgentReason(tally.reviews),
      statistics: statisticsOfIssue(input, counted, tally),
    }))
    .sort(byFixFirstOrder)
    .slice(0, MAX_FIX_FIRST)
}

export function watchItems(
  input: SectionInput,
  counted: CountedReviews,
): readonly WatchItem[] {
  return visibleTallies(input, counted, 'complaint')
    .filter(({ tally }) => tally.reviews.length < FIX_FIRST_MIN_REVIEWS)
    .map(({ tally, group }) => ({
      issueId: group.id,
      title: issueTitle(group),
      topic: group.topic,
      reviewCount: (tally.reviews.length === 1 ? 1 : 2) as 1 | 2,
    }))
    .sort(
      (left, right) =>
        right.reviewCount - left.reviewCount ||
        left.title.localeCompare(right.title) ||
        byIssueIdThen(left.issueId, right.issueId),
    )
    .slice(0, MAX_WATCH)
}

export function guestsLoveItems(
  input: SectionInput,
  counted: CountedReviews,
): readonly GuestsLoveItem[] {
  return visibleTallies(input, counted, 'praise')
    .filter(({ tally }) => tally.reviews.length >= GUESTS_LOVE_MIN_REVIEWS)
    .map(({ tally, group }) => ({
      issueId: group.id,
      title: issueTitle(group),
      topic: group.topic,
      statistics: statisticsOfIssue(input, counted, tally),
    }))
    .sort(
      (left, right) =>
        right.statistics.reviewCount - left.statistics.reviewCount ||
        byIssueIdThen(left.issueId, right.issueId),
    )
    .slice(0, MAX_GUESTS_LOVE)
}

/** Bad news first: a problem rising, praise falling, then a problem falling, praise rising. */
function newsRank(item: ChangedItem): number {
  if (item.polarity === 'complaint') return item.change === 'rising' ? 0 : 2
  return item.change === 'falling' ? 1 : 3
}

export function whatChangedItems(
  input: SectionInput,
  counted: CountedReviews,
): readonly ChangedItem[] {
  const items: ChangedItem[] = []
  for (const sense of ['complaint', 'praise'] as const) {
    for (const { tally, group } of visibleTallies(input, counted, sense)) {
      const statistics = statisticsOfIssue(input, counted, tally)
      if (
        statistics.evidenceLevel !== 'likely' ||
        (statistics.change !== 'rising' && statistics.change !== 'falling')
      ) {
        continue
      }
      items.push({
        issueId: group.id,
        title: issueTitle(group),
        topic: group.topic,
        change: statistics.change,
        evidenceLevel: 'likely',
        statistics,
        polarity: sense,
      })
    }
  }
  return items
    .sort(
      (left, right) =>
        newsRank(left) - newsRank(right) ||
        right.statistics.reviewCount - left.statistics.reviewCount ||
        byIssueIdThen(left.issueId, right.issueId),
    )
    .slice(0, MAX_WHAT_CHANGED)
}

/** Every topic named in the window, the most named first; the taxonomy's order breaks ties. */
export function everyTopicRows(input: SectionInput): readonly TopicRow[] {
  const topics = tallyTopics(input.current)
  const preceding = countTopicReviews(input.baseline)
  const order = new Map<ReviewTopicV3, number>(
    REVIEW_TOPICS_V3.map((topic, index) => [topic, index]),
  )
  return [...topics.values()]
    .map((tally) => ({
      topic: tally.topic,
      praiseReviews: tally.praise,
      complaintReviews: tally.complaint,
      neutralReviews: tally.neutral,
      statistics: issueStatistics(input.windowFacts, {
        stars: tally.stars,
        before: preceding.get(tally.topic) ?? 0,
      }),
    }))
    .sort(
      (left, right) =>
        right.statistics.reviewCount - left.statistics.reviewCount ||
        (order.get(left.topic) ?? 0) - (order.get(right.topic) ?? 0),
    )
}
