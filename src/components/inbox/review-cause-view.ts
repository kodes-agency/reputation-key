// What the Inbox says of a review's v3 analysis, as plain functions: the words on a cause
// chip, and which mentions count after a manager's correction. Pure, so each sentence the
// pane can print is tested without rendering anything. The sentences the analysis cites
// in the guest's own words are `review-evidence-view.ts`.
import type {
  InboxMentionV3,
  InboxReviewAnalysis,
} from '#/contexts/inbox/application/public-api'
import { REVIEW_TOPIC_LABELS_V3 } from '#/shared/review-topic-taxonomy'

export type ReadyAnalysisV3 = Extract<InboxReviewAnalysis, { status: 'ready_v3' }>

/** Which way a mention points once a manager's word is counted. */
export type MentionSense = 'complaint' | 'praise' | 'neutral'

/** A manager's "not a problem" turns a complaint into a neutral remark. */
export function senseOfMention(mention: InboxMentionV3): MentionSense {
  if (mention.correction?.kind === 'not_a_problem') return 'neutral'
  if (mention.polarity === 'negative') return 'complaint'
  return mention.polarity === 'positive' ? 'praise' : 'neutral'
}

/** A removed topic is set aside: it is shown struck through, with the way to give it back. */
export function isRemoved(mention: InboxMentionV3): boolean {
  return mention.correction?.kind === 'remove_topic'
}

/** The cause as it stands: the manager's, if they changed it, else the AI's. */
export function effectiveCause(
  mention: InboxMentionV3,
): Readonly<{ thing: string | null; issue: string | null }> {
  return mention.correction?.kind === 'change_cause'
    ? { thing: mention.correction.thing, issue: mention.correction.issue }
    : { thing: mention.thing, issue: mention.issue }
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * What a chip says: the thing named, or the topic when the guest named none, and what
 * was wrong or right with it. "Air conditioning" and "not working"; "Staff and service".
 */
export function causeWords(
  mention: InboxMentionV3,
): Readonly<{ title: string; detail: string | null }> {
  const { thing, issue } = effectiveCause(mention)
  return {
    title: thing === null ? REVIEW_TOPIC_LABELS_V3[mention.topic] : capitalized(thing),
    detail: issue,
  }
}

const SENSE_WORD: Readonly<Record<MentionSense, string>> = {
  complaint: 'Complaint',
  praise: 'Praise',
  neutral: 'Neutral',
}

export function senseWord(sense: MentionSense): string {
  return SENSE_WORD[sense]
}

/** The cause alone, as one phrase: "Air conditioning, not working". */
export function causeLine(mention: InboxMentionV3): string {
  const { title, detail } = causeWords(mention)
  return detail === null ? title : `${title}, ${detail}`
}

/** The whole chip, as one line for a screen reader or a menu: "Air conditioning, not working · Complaint". */
export function chipSentence(mention: InboxMentionV3): string {
  return `${causeLine(mention)} · ${senseWord(senseOfMention(mention))}`
}

/** What a manager's word did to a mention, in a word; null for a mention left as the AI read it. */
export function correctionWord(mention: InboxMentionV3): string | null {
  switch (mention.correction?.kind) {
    case 'remove_topic':
      return 'Removed'
    case 'not_a_problem':
      return 'Not a problem'
    case 'change_cause':
      return 'Cause changed'
    default:
      return null
  }
}

const SENSE_OF_POLARITY: Readonly<Record<InboxMentionV3['polarity'], MentionSense>> = {
  negative: 'complaint',
  positive: 'praise',
  neutral: 'neutral',
}

/** The mentions of one issue, in the way a link counted them: the chips an `?issue=` link is about. */
export function matchedMentionOrdinals(
  mentions: readonly InboxMentionV3[],
  match: Readonly<{ issueId: string; polarity?: InboxMentionV3['polarity'] }> | null,
): ReadonlySet<number> {
  if (match === null) return new Set()
  const sense = match.polarity === undefined ? null : SENSE_OF_POLARITY[match.polarity]
  return new Set(
    mentions
      .filter(
        (mention) =>
          !isRemoved(mention) &&
          mention.issueGroupId === match.issueId &&
          (sense === null || senseOfMention(mention) === sense),
      )
      .map((mention) => mention.mentionOrdinal),
  )
}

/** "Matched: Air conditioning, not working": the causes an address was about; null when this review holds none. */
export function matchedLine(
  mentions: readonly InboxMentionV3[],
  matched: ReadonlySet<number>,
): string | null {
  const causes = new Set(
    mentions.filter((mention) => matched.has(mention.mentionOrdinal)).map(causeLine),
  )
  return causes.size === 0 ? null : `Matched: ${[...causes].join('; ')}`
}
