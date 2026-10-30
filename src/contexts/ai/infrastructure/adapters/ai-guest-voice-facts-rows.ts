// Rows of the Guest voice 2.0 facts read, checked on their way into the application. A
// row the database should never have written (a topic outside the twelve, a rating of 7)
// is an error here, loud, rather than a figure on a page.
import { z } from 'zod/v4'
import {
  REVIEW_NAMES_PERSON_V3,
  REVIEW_POLARITIES_V3,
  REVIEW_STRENGTHS_V3,
  REVIEW_URGENT_REASONS_V3,
} from '#/shared/review-analysis-v3'
import { REVIEW_TOPICS_V3 } from '#/shared/review-topic-taxonomy'
import type {
  GuestVoiceIssueGroup,
  GuestVoiceReview,
  StarValue,
} from '../../application/read-models/guest-voice-v2-facts'
import type { GuestVoiceUnavailableReview } from '../../application/ports/ai-guest-voice-facts.port'

const mentionRowSchema = z
  .object({
    ordinal: z.number().int().min(0),
    topic: z.enum(REVIEW_TOPICS_V3),
    polarity: z.enum(REVIEW_POLARITIES_V3),
    strength: z.enum(REVIEW_STRENGTHS_V3),
    thing: z.string().nullable(),
    cause: z.string().nullable(),
    group: z.uuid().nullable(),
    names: z.enum(REVIEW_NAMES_PERSON_V3).nullable(),
  })
  .strict()

const mentionRowsSchema = z.array(mentionRowSchema)

/** One review as the facts query returns it: its latest contribution and the mentions as JSON. */
export type FactsRow = Readonly<{
  reviewId: string
  sourceRevision: number | string
  analysisSequence: number | string
  localDate: string
  rating: number
  status: string
  urgentReason: string | null
  /** Any mention of the answer names a person, counting one a manager set aside. */
  namesAPerson: boolean
  mentions: unknown
}>

export type MappedFactsRow =
  | Readonly<{ kind: 'ready'; review: GuestVoiceReview }>
  | Readonly<{ kind: 'unavailable'; review: GuestVoiceUnavailableReview }>

function safeInteger(value: number | string): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Guest voice facts row has an invalid version')
  }
  return parsed
}

function star(rating: number): StarValue {
  if (rating !== 1 && rating !== 2 && rating !== 3 && rating !== 4 && rating !== 5) {
    throw new Error('Guest voice facts row has an invalid rating')
  }
  return rating
}

function urgentReason(value: string | null): GuestVoiceReview['urgentReason'] {
  if (value === null) return null
  const reason = REVIEW_URGENT_REASONS_V3.find((candidate) => candidate === value)
  if (reason === undefined) throw new Error('Guest voice facts row has an invalid reason')
  return reason
}

export function mapFactsRow(row: FactsRow, sourceEpoch: number): MappedFactsRow {
  const sourceRevision = safeInteger(row.sourceRevision)
  const analysisSequence = safeInteger(row.analysisSequence)
  if (row.status === 'unavailable') {
    return {
      kind: 'unavailable',
      review: {
        reviewId: row.reviewId,
        sourceRevision,
        analysisSequence,
        localDate: row.localDate,
      },
    }
  }
  if (row.status !== 'ready')
    throw new Error('Guest voice facts row has an invalid status')
  const mentions = mentionRowsSchema.parse(row.mentions)
  return {
    kind: 'ready',
    review: {
      reviewId: row.reviewId,
      sourceEpoch,
      sourceRevision,
      analysisSequence,
      localDate: row.localDate,
      rating: star(row.rating),
      urgentReason: urgentReason(row.urgentReason),
      namesAPerson: z.boolean().parse(row.namesAPerson),
      mentions: mentions.map((mention) => ({
        mentionOrdinal: mention.ordinal,
        topic: mention.topic,
        polarity: mention.polarity,
        strength: mention.strength,
        thing: mention.thing,
        cause: mention.cause,
        issueGroupId: mention.group,
        namesPerson: mention.names,
      })),
    },
  }
}

export type GroupRow = Readonly<{
  id: string
  topic: string
  canonicalThing: string | null
  displayName: string | null
  hidden: boolean
}>

export function mapGroupRow(row: GroupRow): GuestVoiceIssueGroup {
  const topic = REVIEW_TOPICS_V3.find((candidate) => candidate === row.topic)
  if (topic === undefined) throw new Error('Property issue group has an invalid topic')
  return {
    id: row.id,
    topic,
    canonicalThing: row.canonicalThing,
    displayName: row.displayName,
    hidden: row.hidden,
  }
}
