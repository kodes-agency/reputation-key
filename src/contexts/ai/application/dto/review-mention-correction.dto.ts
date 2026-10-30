import { z } from 'zod/v4'
import { REVIEW_ANALYSIS_V3_MAX_MENTIONS } from '#/shared/review-analysis-v3'

// What a manager may say to correct a review's reading ("Not right?"). The server function
// validates a request with `correctReviewMentionDto`; the Inbox form that asks for a changed
// cause validates what was typed with `changeCauseFormDto` before it sends anything.

/** The longest phrase either box takes; the use case folds and checks the words themselves. */
const CAUSE_BOX_MAX_LENGTH = 80

/** A cause phrase is typed by a person: the use case folds and checks it, this only bounds it. */
const causePhrase = z.string().max(CAUSE_BOX_MAX_LENGTH).nullable()

export const correctReviewMentionDto = z.strictObject({
  reviewId: z.uuid(),
  /**
   * The reading the manager was looking at. A mention number only means something inside
   * the analysis it came from, so a review read again since answers not found.
   */
  analysisSequence: z.number().int().min(0),
  mentionOrdinal: z
    .number()
    .int()
    .min(0)
    .max(REVIEW_ANALYSIS_V3_MAX_MENTIONS - 1),
  action: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('remove_topic') }),
    z.strictObject({ kind: z.literal('not_a_problem') }),
    z.strictObject({ kind: z.literal('undo') }),
    z.strictObject({
      kind: z.literal('change_cause'),
      thing: causePhrase,
      issue: causePhrase,
    }),
  ]),
})

/** The two boxes of the change-cause form as typed: what it is about (may be empty), and what was said of it. */
export const changeCauseFormDto = z.strictObject({
  thing: z.string().max(CAUSE_BOX_MAX_LENGTH, 'Use at most 80 characters'),
  issue: z
    .string()
    .trim()
    .min(1, 'Add a few words')
    .max(CAUSE_BOX_MAX_LENGTH, 'Use at most 80 characters'),
})
