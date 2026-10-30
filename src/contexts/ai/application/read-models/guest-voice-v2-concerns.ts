import type { ReviewUrgentReasonV3 } from '#/shared/review-analysis-v3'
import type {
  GuestVoiceSeriousConcerns,
  UrgentConcernItem,
} from './guest-voice-v2-check-in'
import type { GuestVoiceIssueGroup, GuestVoiceReview } from './guest-voice-v2-facts'
import { primaryComplaint } from './guest-voice-v2-selection'
import { lastMentionedLocalDate } from './guest-voice-v2-recency'
import { issueTitles } from './guest-voice-v2-titles'
import { tallyIssues } from './guest-voice-v2-tally'

const OTHER_TITLES: Readonly<Record<ReviewUrgentReasonV3, string>> = {
  health: 'Reported health concerns',
  safety: 'Reported safety concerns',
  discrimination: 'Reported discrimination',
  legal_threat: 'Reported legal threats',
}
export type ConcernGroup = Readonly<{
  item: UrgentConcernItem
  reviews: readonly GuestVoiceReview[]
}>

/** One review, one primary surviving issue + reason. Hidden issues remain visible. */
export function groupSeriousConcerns(
  reviews: readonly GuestVoiceReview[],
  groups: ReadonlyMap<string, GuestVoiceIssueGroup>,
): readonly ConcernGroup[] {
  const titles = issueTitles(
    [...tallyIssues(reviews).values()].filter((t) => t.sense === 'complaint'),
    groups,
  )
  const buckets = new Map<
    string,
    { issueId: string | null; reason: ReviewUrgentReasonV3; reviews: GuestVoiceReview[] }
  >()
  for (const review of new Map(reviews.map((r) => [r.reviewId, r])).values()) {
    if (review.urgentReason === null) continue
    const surviving = {
      ...review,
      mentions: review.mentions.filter(
        (m) => m.issueGroupId !== null && groups.has(m.issueGroupId),
      ),
    }
    const issueId = primaryComplaint(surviving)?.issueGroupId ?? null
    const key =
      issueId === null
        ? `other:${review.urgentReason}`
        : `issue:${issueId}:${review.urgentReason}`
    const bucket = buckets.get(key) ?? {
      issueId,
      reason: review.urgentReason,
      reviews: [],
    }
    bucket.reviews.push(review)
    buckets.set(key, bucket)
  }
  return [...buckets]
    .map(([key, bucket]) => {
      const group = bucket.issueId === null ? undefined : groups.get(bucket.issueId)
      return {
        reviews: bucket.reviews,
        item: {
          key,
          issueId: bucket.issueId,
          urgentReason: bucket.reason,
          topic: group?.topic ?? null,
          title: group
            ? (titles.get(group.id) ?? OTHER_TITLES[bucket.reason])
            : OTHER_TITLES[bucket.reason],
          reviewCount: bucket.reviews.length,
          lastReportedLocalDate: lastMentionedLocalDate(bucket.reviews) ?? '',
        },
      }
    })
    .sort(
      (a, b) =>
        b.item.reviewCount - a.item.reviewCount ||
        b.item.lastReportedLocalDate.localeCompare(a.item.lastReportedLocalDate) ||
        a.item.key.localeCompare(b.item.key),
    )
}

export function seriousConcerns(
  groups: readonly ConcernGroup[],
  provisional: boolean,
): GuestVoiceSeriousConcerns {
  return {
    items: groups.slice(0, 10).map((g) => g.item),
    groupCount: groups.length,
    reviewCount: groups.reduce((n, g) => n + g.item.reviewCount, 0),
    remainingGroupCount: Math.max(0, groups.length - 10),
    remainingReviewCount: groups.slice(10).reduce((n, g) => n + g.item.reviewCount, 0),
    coverage: provisional ? 'provisional' : 'complete',
  }
}
