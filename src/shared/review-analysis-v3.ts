import { z } from 'zod/v4'
import { REVIEW_TOPIC_TAXONOMY_VERSION, REVIEW_TOPICS_V3 } from './review-topic-taxonomy'
import { REVIEW_SENTENCES_VERSION } from './review-sentences'

export const REVIEW_SENTIMENTS_V3 = Object.freeze([
  'positive',
  'neutral',
  'negative',
  'mixed',
] as const)
export type ReviewSentimentV3 = (typeof REVIEW_SENTIMENTS_V3)[number]

export const REVIEW_POLARITIES_V3 = Object.freeze([
  'positive',
  'neutral',
  'negative',
] as const)
export type ReviewPolarityV3 = (typeof REVIEW_POLARITIES_V3)[number]

export const REVIEW_STRENGTHS_V3 = Object.freeze(['mild', 'clear', 'strong'] as const)
export type ReviewStrengthV3 = (typeof REVIEW_STRENGTHS_V3)[number]

export const REVIEW_NAMES_PERSON_V3 = Object.freeze(['team_member', 'other'] as const)
export type ReviewNamesPersonV3 = (typeof REVIEW_NAMES_PERSON_V3)[number]

export const REVIEW_URGENT_REASONS_V3 = Object.freeze([
  'safety',
  'health',
  'discrimination',
  'legal_threat',
] as const)
export type ReviewUrgentReasonV3 = (typeof REVIEW_URGENT_REASONS_V3)[number]

export const REVIEW_ATTENTION_LEVELS_V2 = Object.freeze([
  'urgent',
  'high',
  'medium',
  'low',
] as const)
export type ReviewAttentionLevelV2 = (typeof REVIEW_ATTENTION_LEVELS_V2)[number]

export const REVIEW_STRENGTH_RANK_V3: Readonly<Record<ReviewStrengthV3, number>> =
  Object.freeze({ mild: 0, clear: 1, strong: 2 })

export function strongerReviewStrengthV3(
  first: ReviewStrengthV3,
  second: ReviewStrengthV3,
): ReviewStrengthV3 {
  return REVIEW_STRENGTH_RANK_V3[first] >= REVIEW_STRENGTH_RANK_V3[second]
    ? first
    : second
}

export const REVIEW_ANALYSIS_V3_MAX_MENTIONS = 48
export const REVIEW_ANALYSIS_V3_MAX_SENTENCE_REFS = 16
export const REVIEW_ANALYSIS_V3_MAX_SENTENCE_NUMBER = 10_000
export const REVIEW_CAUSE_PHRASE_MAX_WORDS = 3
export const REVIEW_CAUSE_PHRASE_MAX_LENGTH = 80

export const REVIEW_CAUSE_PHRASE_PATTERN =
  // eslint-disable-next-line security/detect-unsafe-regex -- Input is bounded by the 80-character check that always runs first.
  /^[a-z]+(?:-[a-z]+)*(?: [a-z]+(?:-[a-z]+)*){0,2}$/

// One cause phrase for the answer a provider is asked for and the one that is stored. The
// pattern is in the strict format a provider receives, so Structured Outputs hold `thing`
// and `issue` to it while decoding (the live v2 schema ships `issueLabel` the same way): a
// guest's "30-minute wait" arrives as "long wait", never as a phrase the normalizer must
// refuse. A provider that does not enforce patterns is not validated by this schema; its
// answer goes to the normalizer, which empties an invalid cause and keeps the mention.
const nullableCauseSchema = z.union([
  z
    .string()
    .max(REVIEW_CAUSE_PHRASE_MAX_LENGTH, { abort: true })
    .regex(REVIEW_CAUSE_PHRASE_PATTERN),
  z.null(),
])
const sentenceNumberSchema = z
  .number()
  .int()
  .min(1)
  .max(REVIEW_ANALYSIS_V3_MAX_SENTENCE_NUMBER)

const providerMentionSchema = z
  .object({
    topic: z.enum(REVIEW_TOPICS_V3),
    polarity: z.enum(REVIEW_POLARITIES_V3),
    strength: z.enum(REVIEW_STRENGTHS_V3),
    thing: nullableCauseSchema,
    issue: nullableCauseSchema,
    sentences: z
      .array(sentenceNumberSchema)
      .min(1)
      .max(REVIEW_ANALYSIS_V3_MAX_SENTENCE_REFS),
    names_person: z.union([z.enum(REVIEW_NAMES_PERSON_V3), z.null()]),
  })
  .strict()

const urgentSchema = z
  .object({
    reason: z.enum(REVIEW_URGENT_REASONS_V3),
  })
  .strict()

export const REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA = z
  .object({
    sentiment: z.enum(REVIEW_SENTIMENTS_V3),
    mentions: z.array(providerMentionSchema).max(REVIEW_ANALYSIS_V3_MAX_MENTIONS),
    urgent: z.union([urgentSchema, z.null()]),
  })
  .strict()

function refineStoredMention(
  value: {
    readonly thing: string | null
    readonly issue: string | null
    readonly sentences: readonly number[]
  },
  context: z.RefinementCtx,
): void {
  if (value.thing !== null && value.issue === null) {
    context.addIssue({
      code: 'custom',
      path: ['issue'],
      message: 'issue is required when thing is present',
    })
  }
  for (let index = 1; index < value.sentences.length; index += 1) {
    const previous = value.sentences[index - 1]
    const current = value.sentences[index]
    if (previous === undefined || current === undefined || current <= previous) {
      context.addIssue({
        code: 'custom',
        path: ['sentences', index],
        message: 'sentence numbers must be strictly ascending and unique',
      })
      return
    }
  }
}

const storedMentionSchema = z
  .object({
    topic: z.enum(REVIEW_TOPICS_V3),
    polarity: z.enum(REVIEW_POLARITIES_V3),
    strength: z.enum(REVIEW_STRENGTHS_V3),
    thing: nullableCauseSchema,
    issue: nullableCauseSchema,
    sentences: z
      .array(sentenceNumberSchema)
      .min(1)
      .max(REVIEW_ANALYSIS_V3_MAX_SENTENCE_REFS),
    names_person: z.union([z.enum(REVIEW_NAMES_PERSON_V3), z.null()]),
  })
  .strict()
  .superRefine(refineStoredMention)

export const REVIEW_ANALYSIS_V3_STORED_SCHEMA = z
  .object({
    sentiment: z.enum(REVIEW_SENTIMENTS_V3),
    mentions: z.array(storedMentionSchema).max(REVIEW_ANALYSIS_V3_MAX_MENTIONS),
    urgent: z.union([urgentSchema, z.null()]),
  })
  .strict()
  .superRefine((value, context) => {
    const keys = new Set<string>()
    for (let index = 0; index < value.mentions.length; index += 1) {
      const mention = value.mentions[index]
      if (mention === undefined) continue
      const key = JSON.stringify([mention.topic, mention.thing, mention.polarity])
      if (keys.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['mentions', index],
          message: 'mention identity must be unique',
        })
      }
      keys.add(key)
    }
  })

export type ReviewAnalysisV3StoredMention = Readonly<{
  topic: (typeof REVIEW_TOPICS_V3)[number]
  polarity: ReviewPolarityV3
  strength: ReviewStrengthV3
  thing: string | null
  issue: string | null
  sentences: readonly number[]
  names_person: ReviewNamesPersonV3 | null
}>

export type ReviewAnalysisV3ProviderAnswer = Readonly<{
  sentiment: ReviewSentimentV3
  mentions: readonly ReviewAnalysisV3StoredMention[]
  urgent: Readonly<{ reason: ReviewUrgentReasonV3 }> | null
}>

export type ReviewAnalysisV3Stored = ReviewAnalysisV3ProviderAnswer

export const REVIEW_ATTENTION_V2_VERSION = 'review-attention-v2' as const
export const REVIEW_ATTENTION_V2_RULES_MANIFEST = Object.freeze({
  version: REVIEW_ATTENTION_V2_VERSION,
  levels: REVIEW_ATTENTION_LEVELS_V2,
  rules: Object.freeze([
    'urgent when an urgent reason is present',
    'high for a clear or strong negative mention, or a rating at most two unless positive',
    'medium for mixed or negative sentiment, or any remaining negative mention',
    'low otherwise',
  ]),
})
export const REVIEW_ATTENTION_V2_DIGEST =
  '42473e84ab5b376cd06940ac4060b7e8c875100507247c91e70450d220bed687' as const

export type DeriveReviewAttentionV2Input = Readonly<{
  rating: number
  sentiment: ReviewSentimentV3
  urgent: Readonly<{ reason: ReviewUrgentReasonV3 }> | null
  mentions: readonly Pick<ReviewAnalysisV3StoredMention, 'polarity' | 'strength'>[]
}>

export function deriveReviewAttentionV2(
  input: DeriveReviewAttentionV2Input,
): ReviewAttentionLevelV2 {
  if (input.urgent !== null) return 'urgent'
  if (
    input.mentions.some(
      (mention) =>
        mention.polarity === 'negative' &&
        (mention.strength === 'clear' || mention.strength === 'strong'),
    ) ||
    (input.rating <= 2 && input.sentiment !== 'positive')
  ) {
    return 'high'
  }
  if (
    input.sentiment === 'mixed' ||
    input.sentiment === 'negative' ||
    input.mentions.some((mention) => mention.polarity === 'negative')
  ) {
    return 'medium'
  }
  return 'low'
}

export const REVIEW_ANALYSIS_V3_VERSIONS = Object.freeze({
  topicTaxonomy: REVIEW_TOPIC_TAXONOMY_VERSION,
  analysisOperation: 'review-analysis-v3',
  capabilityRuntime: 'review-analysis-runtime-v2',
  gatewayProfile: 'review-analysis-gateway-v2',
  normalizer: 'review-analysis-normalization-v1',
  sentenceRules: REVIEW_SENTENCES_VERSION,
  attentionFormula: REVIEW_ATTENTION_V2_VERSION,
  vocabularyCatalogue: 'review-vocabulary-hints-v1',
  issueNormalization: 'property-issue-normalization-v1',
  providerDeployment: 'private-beta-global-v2',
  guestVoiceReadModel: 'guest-voice-read-v2',
})

/**
 * Whether review analysis v3 is the analysis the product runs: true since the switch-on
 * (2026-10-30). What only v3 produces (the Urgent alert, the Monday Guest voice summary)
 * is offered in Settings only while it is, and `ai-runtime-capability-contract.test.ts`
 * pins this to the runtime catalogue's selection, so turning the selection back turns
 * this back with it, and the preferences for what v3 does not produce go with it.
 */
export const REVIEW_ANALYSIS_V3_LIVE: boolean = true
