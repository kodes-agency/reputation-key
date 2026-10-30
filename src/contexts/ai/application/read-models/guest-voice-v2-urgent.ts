// The Urgent strip of the Guest voice 2.0 page. An Urgent review is one where a guest
// reported a risk to safety or health, discrimination or a legal threat (the AI's
// attention, with its reason). The strip lists them by the problem they report so each
// has a drawer to open, one card per issue however many reviews report it.
//
// A manager hiding an issue does not hide its Urgent reviews: the strip is a safety
// signal, not a ranking, and the alert has already gone out for each.
import { groupSeriousConcerns, type ConcernGroup } from './guest-voice-v2-concerns'
import { issueAnswerName, issueDisplayTitle } from './guest-voice-v2-titles'
import { lastMentionedLocalDate } from './guest-voice-v2-recency'
import type { FixFirstItem } from './guest-voice-v2'
import {
  pickUrgentEvidenceCandidates,
  type EvidenceSlot,
} from './guest-voice-v2-evidence'
import type { GuestVoiceReview } from './guest-voice-v2-facts'
import {
  MAX_CAUSES,
  mostSevereUrgentReason,
  statisticsOfIssue,
  topCauses,
  type CountedReviews,
  type SectionInput,
} from './guest-voice-v2-sections'
import { issueSenseKey } from './guest-voice-v2-tally'

/** At most this many Urgent cards: more than this is a Property that needs a person, not a page. */
const MAX_URGENT = 10

export type UrgentSection = Readonly<{
  items: readonly FixFirstItem[]
  evidence: readonly EvidenceSlot[]
  /** Urgent reviews no card stands for: they name no problem, or the cards are full. */
  otherCount: number
}>

function latestDay(reviews: readonly GuestVoiceReview[]): string {
  return reviews.reduce(
    (latest, review) => (review.localDate > latest ? review.localDate : latest),
    '',
  )
}

export function urgentSection(
  input: SectionInput,
  counted: CountedReviews,
  concerns: readonly ConcernGroup[] = groupSeriousConcerns(input.current, input.groups),
): UrgentSection {
  const byIssue = new Map<string, GuestVoiceReview[]>()
  let otherCount = 0
  for (const concern of concerns) {
    const groupId = concern.item.issueId
    if (groupId === null) {
      otherCount += concern.reviews.length
      continue
    }
    byIssue.set(groupId, [...(byIssue.get(groupId) ?? []), ...concern.reviews])
  }

  const built: Array<
    Readonly<{ item: FixFirstItem; slot: EvidenceSlot; count: number; day: string }>
  > = []
  for (const [groupId, reviews] of byIssue) {
    const group = input.groups.get(groupId)
    const tally = counted.issues.get(issueSenseKey(groupId, 'complaint'))
    if (group === undefined || tally === undefined) {
      otherCount += reviews.length
      continue
    }
    built.push({
      count: reviews.length,
      day: latestDay(reviews),
      item: {
        issueId: groupId,
        title: issueDisplayTitle(group, tally),
        answerName: issueAnswerName(group, tally),
        lastMentionedLocalDate: lastMentionedLocalDate(reviews) ?? '',
        topic: group.topic,
        causes: topCauses(tally, MAX_CAUSES),
        urgentReason: mostSevereUrgentReason(reviews),
        statistics: statisticsOfIssue(input, counted, tally),
      },
      slot: {
        section: 'urgent',
        issueId: groupId,
        candidates: pickUrgentEvidenceCandidates(reviews, groupId),
      },
    })
  }
  built.sort(
    (left, right) =>
      right.count - left.count ||
      right.day.localeCompare(left.day) ||
      left.item.issueId.localeCompare(right.item.issueId),
  )
  const shown = built.slice(0, MAX_URGENT)
  return {
    items: shown.map(({ item }) => item),
    evidence: shown.map(({ slot }) => slot),
    otherCount:
      otherCount + built.slice(MAX_URGENT).reduce((sum, { count }) => sum + count, 0),
  }
}
