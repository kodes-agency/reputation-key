import { REVIEW_TOPIC_LABELS_V3 } from '#/shared/review-topic-taxonomy'
import {
  guestVoiceWindowContext,
  sectionInput,
  type GuestVoiceBuildInput,
} from './guest-voice-v2-build'
import type {
  GuestVoiceDetailRead,
  GuestVoiceDetailTarget,
  GuestVoiceHistoryMonth,
  GuestVoiceCauseRow,
} from './guest-voice-v2-check-in'
import { groupSeriousConcerns, type ConcernGroup } from './guest-voice-v2-concerns'
import {
  pickEvidenceCandidates,
  pickUrgentEvidenceCandidates,
  liveEvidenceOf,
  type EvidenceCandidate,
  type EvidenceSlot,
  type ResolvedReview,
} from './guest-voice-v2-evidence'
import { senseOf, type GuestVoiceReview } from './guest-voice-v2-facts'
import {
  calendarMonths,
  lastMentionedLocalDate,
  twelveMonthStart,
} from './guest-voice-v2-recency'
import { causeCounts } from './guest-voice-v2-causes'
import { issueTitles, mentionCauseTitle } from './guest-voice-v2-titles'
import {
  countReviews,
  everyTopicRows,
  statisticsOfIssue,
} from './guest-voice-v2-sections'
import { issueSenseKey } from './guest-voice-v2-tally'

export type GuestVoiceDetailDraft = Readonly<{
  read: Extract<GuestVoiceDetailRead, { status: 'ready' }>
  evidence: readonly EvidenceSlot[]
  latest: readonly []
}>
export type GuestVoiceDetailBuildInput = Readonly<{
  build: GuestVoiceBuildInput
  history: readonly GuestVoiceReview[]
  historyStartLocalDate: string
  target: GuestVoiceDetailTarget
}>

function mean(reviews: readonly GuestVoiceReview[]): number | null {
  return reviews.length === 0
    ? null
    : reviews.reduce((n, r) => n + r.rating, 0) / reviews.length
}
function linkedConcerns(
  reviews: readonly GuestVoiceReview[],
  concerns: readonly ConcernGroup[],
) {
  const ids = new Set(reviews.map((r) => r.reviewId))
  return concerns
    .filter((c) => c.reviews.some((r) => ids.has(r.reviewId)))
    .map((c) => c.item)
}
function historyMonths(
  input: GuestVoiceDetailBuildInput,
  members: ReadonlySet<string>,
): Readonly<{
  historyCoverage: 'twelve_months' | 'window_only'
  months: readonly GuestVoiceHistoryMonth[]
}> {
  const first = twelveMonthStart(input.build.endLocalDate)
  const full = input.historyStartLocalDate <= first
  const period = {
    startLocalDate: full ? first : input.build.startLocalDate,
    endLocalDate: input.build.endLocalDate,
  }
  return {
    historyCoverage: full ? 'twelve_months' : 'window_only',
    months: calendarMonths(period).map((m) => {
      const reviews = input.history.filter(
        (r) => r.localDate >= m.startLocalDate && r.localDate <= m.endLocalDate,
      )
      return {
        ...m,
        reviewCount: reviews.filter((r) => members.has(r.reviewId)).length,
        textReviews: reviews.length,
      }
    }),
  }
}
function topicCauses(
  input: GuestVoiceBuildInput,
  topic: GuestVoiceDetailTarget & { kind: 'topic' },
  sense: 'complaint' | 'praise',
): readonly GuestVoiceCauseRow[] {
  const rows = new Map<
    string,
    { issueId: string | null; title: string; ids: Set<string> }
  >()
  for (const review of input.current) {
    for (const m of review.mentions) {
      if (m.topic !== topic.topic || senseOf(m.polarity) !== sense) continue
      const cause = m.cause?.trim().toLowerCase() ?? ''
      const title = mentionCauseTitle(
        m,
        m.issueGroupId === null ? undefined : input.groups.get(m.issueGroupId),
      )
      const key = `${m.issueGroupId ?? 'other'}:${cause}`
      const row = rows.get(key) ?? {
        issueId: m.issueGroupId,
        title,
        ids: new Set<string>(),
      }
      row.ids.add(review.reviewId)
      rows.set(key, row)
    }
  }
  return [...rows.values()]
    .map((r) => ({ issueId: r.issueId, title: r.title, reviewCount: r.ids.size }))
    .sort(
      (a, b) =>
        b.reviewCount - a.reviewCount ||
        a.title.localeCompare(b.title) ||
        (a.issueId ?? '').localeCompare(b.issueId ?? ''),
    )
}

/** All drafts are content-free. Only delivery can attach reader-authorized live words. */
export function buildGuestVoiceDetail(
  input: GuestVoiceDetailBuildInput,
): GuestVoiceDetailDraft | null {
  const { build, target } = input
  const context = guestVoiceWindowContext(build)
  const sections = sectionInput(build)
  const counted = countReviews(sections)
  const concerns = groupSeriousConcerns(build.current, build.groups)
  const matchingReviews = {
    startLocalDate: build.startLocalDate,
    endLocalDate: build.endLocalDate,
  }
  if (target.kind === 'topic') {
    const row = everyTopicRows(sections).find((r) => r.topic === target.topic)
    if (!row) return null
    const members = build.current.filter((r) =>
      r.mentions.some((m) => m.topic === target.topic),
    )
    return {
      read: {
        status: 'ready',
        drawer: {
          kind: 'topic',
          topic: target.topic,
          assessment: row.assessment,
          context,
          likedCauses: topicCauses(build, target, 'praise'),
          dislikedCauses: topicCauses(build, target, 'complaint'),
          linkedConcerns: linkedConcerns(members, concerns),
        },
      },
      evidence: [],
      latest: [],
    }
  }
  if (target.kind === 'concern') {
    const concern = concerns.find(
      (c) => c.item.issueId === target.issueId && c.item.urgentReason === target.reason,
    )
    if (!concern) return null
    const members = new Set(concern.reviews.map((r) => r.reviewId))
    const candidates =
      target.issueId === null
        ? []
        : pickUrgentEvidenceCandidates(concern.reviews, target.issueId)
    const monthlySeries = calendarMonths(build).map((m) => ({
      ...m,
      reviewCount: concern.reviews.filter(
        (r) =>
          r.localDate >= m.startLocalDate &&
          r.localDate <= m.endLocalDate &&
          members.has(r.reviewId),
      ).length,
      textReviews: build.current.filter(
        (r) => r.localDate >= m.startLocalDate && r.localDate <= m.endLocalDate,
      ).length,
    }))
    return {
      read: {
        status: 'ready',
        drawer: {
          kind: 'concern',
          target,
          title: concern.item.title,
          reason: target.reason,
          reviewCount: concern.item.reviewCount,
          lastReportedLocalDate: concern.item.lastReportedLocalDate,
          context,
          liveEvidence: [],
          monthlySeries,
          matchingReviews: {
            ...matchingReviews,
            issueId: target.issueId,
            sense: target.issueId === null ? null : 'complaint',
          },
        },
      },
      evidence: [{ section: 'urgent', issueId: concern.item.key, candidates }],
      latest: [],
    }
  }
  const group = build.groups.get(target.issueId)
  const tally = counted.issues.get(issueSenseKey(target.issueId, target.sense))
  if (!group || !tally) return null
  const ids = new Set(tally.reviews.map((r) => r.reviewId))
  const others = build.current.filter((r) => !ids.has(r.reviewId))
  const historyMembers = new Set(
    input.history
      .filter((r) =>
        r.mentions.some(
          (m) =>
            m.issueGroupId === target.issueId && senseOf(m.polarity) === target.sense,
        ),
      )
      .map((r) => r.reviewId),
  )
  const history = historyMonths(input, historyMembers)
  const titles = issueTitles(
    [...counted.issues.values()].filter((t) => t.sense === target.sense),
    build.groups,
  )
  return {
    read: {
      status: 'ready',
      drawer: {
        kind: 'issue',
        issueId: group.id,
        title: titles.get(group.id) ?? REVIEW_TOPIC_LABELS_V3[group.topic],
        topic: group.topic,
        sense: target.sense,
        definition: group.canonicalThing ?? REVIEW_TOPIC_LABELS_V3[group.topic],
        hidden: group.hidden,
        context,
        lastMentionedLocalDate:
          lastMentionedLocalDate(tally.reviews) ?? build.endLocalDate,
        statistics: statisticsOfIssue(sections, counted, tally),
        commentComparison: {
          population: 'current_analysed_comments',
          mentionedCount: tally.reviews.length,
          otherCount: others.length,
          mentionedAverage: mean(tally.reviews),
          othersAverage: mean(others),
        },
        linkedConcerns: linkedConcerns(tally.reviews, concerns),
        matchingReviews: { ...matchingReviews, issueId: group.id, sense: target.sense },
        historyCoverage: history.historyCoverage,
        // complaintReviews remains a compatibility alias for the existing drawer consumer.
        twelveMonthSeries: history.months.map((m) => ({
          ...m,
          complaintReviews: m.reviewCount,
        })),
        causes: causeCounts(tally),
        liveEvidence: [],
      },
    },
    evidence: [
      {
        section: target.sense === 'praise' ? 'guestsLove' : 'fixFirst',
        issueId: group.id,
        candidates: pickEvidenceCandidates(tally.reviews, group.id, target.sense),
      },
    ],
    latest: [],
  }
}

export function withDetailLiveEvidence(
  draft: GuestVoiceDetailDraft,
  resolved: ReadonlyMap<string, ResolvedReview>,
): GuestVoiceDetailRead {
  const drawer = draft.read.drawer
  if (drawer.kind === 'topic') return draft.read
  const liveEvidence = draft.evidence
    .flatMap((slot) => slot.candidates)
    .map((candidate: EvidenceCandidate) =>
      liveEvidenceOf(candidate, resolved.get(candidate.reviewId)),
    )
    .filter((quote) => quote !== null)
  return { status: 'ready', drawer: { ...drawer, liveEvidence } }
}
