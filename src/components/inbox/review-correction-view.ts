// What the "Not right?" dialog says and offers, as plain functions: which rows it lists
// for a review's mentions, which words a manager may give each, and what to tell them
// when the answer is not "done". Pure, so each sentence is tested without rendering.
import type {
  CorrectReviewMentionResult,
  MentionCorrectionAction,
} from '#/contexts/ai/application/public-api'
import type { InboxMentionV3 } from '#/contexts/inbox/application/public-api'
import { REVIEW_TOPIC_LABELS_V3 } from '#/shared/review-topic-taxonomy'
import { isRemoved, senseOfMention, type MentionSense } from './review-cause-view'

/** One line of the dialog: a reading the manager may correct, or a topic they set aside. */
export type CorrectionRow =
  | Readonly<{ kind: 'reading'; mention: InboxMentionV3 }>
  | Readonly<{ kind: 'removed_topic'; mention: InboxMentionV3 }>

/**
 * The lines of the dialog, in the order the answer gave them. A topic that was removed
 * comes back as one line, however many mentions it held: giving one back gives the topic
 * back whole, as it went.
 */
export function correctionRows(
  mentions: readonly InboxMentionV3[],
): readonly CorrectionRow[] {
  const removedTopics = new Set<string>()
  const rows: CorrectionRow[] = []
  for (const mention of mentions) {
    if (!isRemoved(mention)) {
      rows.push({ kind: 'reading', mention })
    } else if (!removedTopics.has(mention.topic)) {
      removedTopics.add(mention.topic)
      rows.push({ kind: 'removed_topic', mention })
    }
  }
  return rows
}

/** The topic of a line, as the product names it: "Facilities and equipment". */
export function topicOfRow(row: CorrectionRow): string {
  return REVIEW_TOPIC_LABELS_V3[row.mention.topic]
}

/** What a reading may be told it is not: a complaint can be called no problem, nothing else can. */
export function mayBeNoProblem(mention: InboxMentionV3): boolean {
  return mention.polarity === 'negative' && mention.correction?.kind !== 'not_a_problem'
}

const CAUSE_LABELS: Readonly<
  Record<MentionSense, Readonly<{ about: string; said: string }>>
> = {
  complaint: { about: 'What it is about', said: 'What was wrong' },
  praise: { about: 'What it is about', said: 'What was good' },
  neutral: { about: 'What it is about', said: 'What was said' },
}

/** The two boxes of the change-cause form, in the words of the way the review feels. */
export function causeFormLabels(
  mention: InboxMentionV3,
): Readonly<{ about: string; said: string }> {
  return CAUSE_LABELS[senseOfMention(mention)]
}

/** How a request ended, for the dialog: done, or refused with a sentence to show. */
export type CorrectionOutcome =
  Readonly<{ kind: 'done' }> | Readonly<{ kind: 'refused'; sentence: string }>

const READ_AGAIN =
  'This review was read again just now. Check what it says now, then try again.'

/** What the server's answer means to the person who asked. */
export function outcomeOf(
  result: CorrectReviewMentionResult,
  action: MentionCorrectionAction,
): CorrectionOutcome {
  switch (result.status) {
    case 'applied':
    case 'cleared':
      return { kind: 'done' }
    case 'not_found':
      return {
        kind: 'refused',
        sentence:
          action.kind === 'undo' ? 'There is nothing to undo here any more.' : READ_AGAIN,
      }
    case 'not_applicable':
      return {
        kind: 'refused',
        sentence: 'Only a complaint can be marked as not a problem.',
      }
    case 'invalid_cause':
      return {
        kind: 'refused',
        sentence:
          'Use one to three plain words in each box: letters and hyphens only, no names or numbers.',
      }
    case 'disabled':
      return {
        kind: 'refused',
        sentence: 'Review analysis is switched off for this organization.',
      }
  }
}
