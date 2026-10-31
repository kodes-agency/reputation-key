// The guests' own words on the Guest voice 2.0 page.
//
// The analysis stores no sentence of a review, only the numbers of the sentences that
// state a mention (`review-sentences-v1`). A quote is therefore made in two steps. The
// read model here chooses *which* reviews could be quoted for each card, without any
// text (`EvidenceSlot`); the delivery layer then reads those reviews' text through
// Review, live, and `withLiveEvidence` cuts it with the same splitter the analysis
// used. Nothing is stored, and a review whose text is gone, changed or cannot be opened
// by the reader is simply not quoted.
//
// A review that names a person is never quoted here (decisions 2 and 17). The flag is
// the analysis's, per mention; because a quote shows the whole review and not only the
// sentences it underlines, a name flagged anywhere in the review would be on the page,
// so one flagged mention keeps the whole review out. It is read from the answer as given,
// not from the mentions left after a manager's corrections: setting the mention that
// carried the name aside takes a topic out of the counts, not the name out of the text.
import {
  REVIEW_STRENGTH_RANK_V3,
  type ReviewStrengthV3,
} from '#/shared/review-analysis-v3'
import { locateReviewSentences } from '#/shared/review-sentences'
import type { GuestVoiceV2Read, LatestReview, LiveEvidence } from './guest-voice-v2'
import type { GuestVoiceMention, GuestVoiceReview, Sense } from './guest-voice-v2-facts'
import { senseOf, type StarValue } from './guest-voice-v2-facts'

/** At most this many reviews are put forward for one card, in the order to try them. */
const EVIDENCE_CANDIDATES_PER_CARD = 3

/** A review that could be quoted for a card, and the sentences its mention cites. */
export type EvidenceCandidate = Readonly<{
  reviewId: string
  mentionOrdinal: number
  /** The Property's day the review was left. */
  reviewedAt: string
  rating: StarValue
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  /** One-based sentence numbers; empty until the store has read them. */
  sentenceNumbers: readonly number[]
}>

export type EvidenceSection = 'urgent' | 'fixFirst' | 'guestsLove'

/** Where a quote goes on the page, and the reviews that could fill it. */
export type EvidenceSlot = Readonly<{
  section: EvidenceSection
  issueId: string
  candidates: readonly EvidenceCandidate[]
}>

/** A recent review of a Property too young for patterns, before its text is read. */
export type LatestReviewReference = Readonly<{
  reviewId: string
  reviewedAt: string
  rating: StarValue
  /** False for a review with only stars, one that names a person, or one not analysed yet. */
  mayShowText: boolean
  /** The revision the review was counted at, and the one its analysis was made on. */
  sourceRevision: number
}>

/** What the use case hands the delivery layer: a read without quotes, and where they go. */
export type GuestVoiceV2Draft = Readonly<{
  read: GuestVoiceV2Read
  evidence: readonly EvidenceSlot[]
  latest: readonly LatestReviewReference[]
}>

export function reviewNamesAPerson(review: GuestVoiceReview): boolean {
  return review.namesAPerson
}

function strengthRank(strength: ReviewStrengthV3): number {
  return REVIEW_STRENGTH_RANK_V3[strength]
}

/** The mention of the issue, in the sense, that says it most strongly. */
function strongestMention(
  review: GuestVoiceReview,
  groupId: string,
  sense: Sense,
): GuestVoiceMention | null {
  let best: GuestVoiceMention | null = null
  for (const mention of review.mentions) {
    if (mention.issueGroupId !== groupId || senseOf(mention.polarity) !== sense) continue
    if (
      best === null ||
      strengthRank(mention.strength) > strengthRank(best.strength) ||
      (strengthRank(mention.strength) === strengthRank(best.strength) &&
        mention.mentionOrdinal < best.mentionOrdinal)
    ) {
      best = mention
    }
  }
  return best
}

type Ranked = Readonly<{ candidate: EvidenceCandidate; weight: number }>

function byWeightThenRecency(left: Ranked, right: Ranked): number {
  return (
    right.weight - left.weight ||
    right.candidate.reviewedAt.localeCompare(left.candidate.reviewedAt) ||
    left.candidate.reviewId.localeCompare(right.candidate.reviewId)
  )
}

function rankedCandidates(
  reviews: readonly GuestVoiceReview[],
  groupId: string,
  sense: Sense,
  weigh: (mention: GuestVoiceMention) => number,
): readonly EvidenceCandidate[] {
  const ranked: Ranked[] = []
  for (const review of reviews) {
    if (reviewNamesAPerson(review)) continue
    const mention = strongestMention(review, groupId, sense)
    if (mention === null) continue
    ranked.push({
      weight: weigh(mention),
      candidate: {
        reviewId: review.reviewId,
        mentionOrdinal: mention.mentionOrdinal,
        reviewedAt: review.localDate,
        rating: review.rating,
        sourceEpoch: review.sourceEpoch,
        sourceRevision: review.sourceRevision,
        analysisSequence: review.analysisSequence,
        sentenceNumbers: [],
      },
    })
  }
  return ranked
    .sort(byWeightThenRecency)
    .slice(0, EVIDENCE_CANDIDATES_PER_CARD)
    .map(({ candidate }) => candidate)
}

/**
 * The reviews to try for a card about one issue, best first: the ones that say it most
 * strongly, then the most recent. A review that names a person is not among them.
 */
export function pickEvidenceCandidates(
  reviews: readonly GuestVoiceReview[],
  groupId: string,
  sense: Sense,
): readonly EvidenceCandidate[] {
  return rankedCandidates(reviews, groupId, sense, (mention) =>
    strengthRank(mention.strength),
  )
}

/**
 * The same for an Urgent card: the Urgent reviews of the issue, most recent first,
 * because it is the guest who reported the risk that is quoted, not the strongest
 * complaint of the issue.
 */
export function pickUrgentEvidenceCandidates(
  urgentReviews: readonly GuestVoiceReview[],
  groupId: string,
): readonly EvidenceCandidate[] {
  return rankedCandidates(urgentReviews, groupId, 'complaint', () => 0)
}

/** What the delivery layer found for one review: the item that opens it, and its text now. */
export type ResolvedReview = Readonly<{
  inboxItemId: string
  /** The review's own words as they stand, or null when they cannot be read. */
  text: string | null
  /** The Review revision those words are, or null when they were not read. */
  sourceRevision: number | null
}>

/**
 * Cuts a review's live text at the sentences an analysis cites. Null when the text is
 * gone, or is not the revision the analysis was made on (the review was edited after
 * it: sentence numbers of one text point at nothing in another), or has fewer sentences
 * than the analysis numbered, or the analysis cited none: better no quote than a quote
 * that underlines the wrong words.
 */
export function liveEvidenceOf(
  candidate: EvidenceCandidate,
  resolved: ResolvedReview | undefined,
): LiveEvidence | null {
  if (resolved === undefined || resolved.text === null) return null
  if (resolved.sourceRevision !== candidate.sourceRevision) return null
  if (candidate.sentenceNumbers.length === 0) return null
  const sentences = locateReviewSentences(resolved.text)
  const ranges: Array<Readonly<{ start: number; end: number }>> = []
  for (const number of candidate.sentenceNumbers) {
    const sentence = sentences.at(number - 1)
    if (number < 1 || sentence === undefined) return null
    ranges.push({ start: sentence.start, end: sentence.end })
  }
  return {
    inboxItemId: resolved.inboxItemId,
    reviewedAt: candidate.reviewedAt,
    rating: candidate.rating,
    text: resolved.text,
    sentenceRanges: ranges.sort((left, right) => left.start - right.start),
  }
}

function firstQuote(
  slot: EvidenceSlot | undefined,
  resolved: ReadonlyMap<string, ResolvedReview>,
): LiveEvidence | null {
  if (slot === undefined) return null
  for (const candidate of slot.candidates) {
    const quote = liveEvidenceOf(candidate, resolved.get(candidate.reviewId))
    if (quote !== null) return quote
  }
  return null
}

function slotKey(section: EvidenceSection, issueId: string): string {
  return `${section}:${issueId}`
}

function latestReviewsOf(
  latest: readonly LatestReviewReference[],
  resolved: ReadonlyMap<string, ResolvedReview>,
): readonly LatestReview[] {
  const reviews: LatestReview[] = []
  for (const reference of latest) {
    const found = resolved.get(reference.reviewId)
    // A review the reader cannot open is not listed: the row is a way into it.
    if (found === undefined) continue
    reviews.push({
      inboxItemId: found.inboxItemId,
      reviewedAt: reference.reviewedAt,
      rating: reference.rating,
      // The words of a review edited since it was counted are not the ones its
      // analysis (and the check that it names nobody) was made on.
      text:
        reference.mayShowText && found.sourceRevision === reference.sourceRevision
          ? found.text
          : null,
    })
  }
  return reviews
}

/**
 * The page with the guests' words read in: each card gets the first of its reviews whose
 * text could be read and cut, and a young Property's latest reviews get theirs.
 */
export function withLiveEvidence(
  draft: GuestVoiceV2Draft,
  resolved: ReadonlyMap<string, ResolvedReview>,
): GuestVoiceV2Read {
  const { read } = draft
  if (read.status === 'not_enough_reviews') {
    const latestReviews = latestReviewsOf(draft.latest, resolved)
    return { ...read, latestReviews, latestReviewCount: latestReviews.length }
  }
  const slots = new Map(
    draft.evidence.map((slot) => [slotKey(slot.section, slot.issueId), slot]),
  )
  const quoteOf = (section: EvidenceSection, issueId: string) =>
    firstQuote(slots.get(slotKey(section, issueId)), resolved)
  return {
    ...read,
    urgent: read.urgent.map((item) => ({
      ...item,
      quote: quoteOf('urgent', item.issueId),
    })),
    fixFirst: read.fixFirst.map((item) => ({
      ...item,
      quote: quoteOf('fixFirst', item.issueId),
    })),
    guestsLove: read.guestsLove.map((item) => ({
      ...item,
      quote: quoteOf('guestsLove', item.issueId),
    })),
  }
}
