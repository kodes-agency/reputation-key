// What the Inbox underlines in a review: the stretches of the guest's own words that a v3
// reading cites. The analysis stores no sentence, only the numbers of the sentences that
// state a mention (`review-sentences-v1`). The pane holds the review's words, so it cuts
// them with the same rule and marks the sentences cited; a number the words no longer
// reach (the review changed since) marks nothing. Pure, so each case is tested without
// rendering anything.
import type {
  InboxMentionV3,
  InboxReviewAnalysis,
} from '#/contexts/inbox/application/public-api'
import { locateReviewSentences } from '#/shared/review-sentences'
import {
  isRemoved,
  matchedMentionOrdinals,
  senseOfMention,
  type MentionSense,
} from './review-cause-view'

/** What the review's own words need to show the sentences a reading cites. */
export type ReviewEvidence = Readonly<{
  /** The guest's own words: the text the sentence numbers were counted in. */
  original: string
  mentions: readonly InboxMentionV3[]
  /** The mentions an address was about, to be marked among the cited sentences. */
  matched: ReadonlySet<number>
}>

/**
 * The evidence of a v3 reading in the words it was read from, or null where there is
 * none to show: no v3 reading, or no words (a rating-only review, content the source no
 * longer serves).
 */
export function reviewEvidenceOf(
  analysis: InboxReviewAnalysis | null | undefined,
  reviewText: string | null | undefined,
  matchedIssue: Parameters<typeof matchedMentionOrdinals>[1],
): ReviewEvidence | null {
  if (analysis?.status !== 'ready_v3') return null
  if (reviewText === null || reviewText === undefined || reviewText.trim() === '') {
    return null
  }
  return {
    original: reviewText,
    mentions: analysis.mentions,
    matched: matchedMentionOrdinals(analysis.mentions, matchedIssue),
  }
}

/** A stretch of the review's words, and what it is: plain, or cited by a mention. */
export type EvidenceSegment = Readonly<{
  text: string
  /** Null for text no mention cites. */
  cited: Readonly<{ sense: MentionSense; matched: boolean }> | null
}>

const SENSE_PRIORITY: Readonly<Record<MentionSense, number>> = {
  complaint: 2,
  praise: 1,
  neutral: 0,
}

type Cited = NonNullable<EvidenceSegment['cited']>

/** What a sentence is cited as once one more mention cites it: the stronger sense, matched if either is. */
function citedAlso(
  before: Cited | undefined,
  sense: MentionSense,
  matched: boolean,
): Cited {
  if (before === undefined) return { sense, matched }
  return {
    sense: SENSE_PRIORITY[before.sense] > SENSE_PRIORITY[sense] ? before.sense : sense,
    matched: before.matched || matched,
  }
}

/** What each sentence of a text of `sentenceCount` sentences is cited as; a removed mention cites nothing. */
function citedSentences(
  sentenceCount: number,
  mentions: readonly InboxMentionV3[],
  matched: ReadonlySet<number>,
): ReadonlyMap<number, Cited> {
  const cited = new Map<number, Cited>()
  for (const mention of mentions) {
    if (isRemoved(mention)) continue
    const sense = senseOfMention(mention)
    const isMatched = matched.has(mention.mentionOrdinal)
    for (const number of mention.sentenceNumbers) {
      // A number the words no longer reach (the review changed since) cites nothing.
      if (number < 1 || number > sentenceCount) continue
      cited.set(number, citedAlso(cited.get(number), sense, isMatched))
    }
  }
  return cited
}

/**
 * The review's words cut at the sentences its mentions cite. A sentence two mentions cite
 * takes the stronger sense (a complaint over praise over a remark), and is `matched` if
 * any of them is the one a link was about. A removed mention cites nothing.
 */
export function evidenceSegments(
  text: string,
  mentions: readonly InboxMentionV3[],
  matched: ReadonlySet<number>,
): readonly EvidenceSegment[] {
  const sentences = locateReviewSentences(text)
  const cited = citedSentences(sentences.length, mentions, matched)
  if (cited.size === 0) return [{ text, cited: null }]

  const segments: EvidenceSegment[] = []
  let cursor = 0
  for (const sentence of sentences) {
    const mark = cited.get(sentence.number)
    if (mark === undefined) continue
    if (sentence.start > cursor) {
      segments.push({ text: text.slice(cursor, sentence.start), cited: null })
    }
    segments.push({ text: text.slice(sentence.start, sentence.end), cited: mark })
    cursor = sentence.end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), cited: null })
  return segments
}
