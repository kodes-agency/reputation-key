import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import commonWordSource from './review-cause-common-words-v1.json'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import {
  REVIEW_ANALYSIS_V3_MAX_MENTIONS,
  REVIEW_ANALYSIS_V3_MAX_SENTENCE_NUMBER,
  REVIEW_ANALYSIS_V3_MAX_SENTENCE_REFS,
  REVIEW_ANALYSIS_V3_STORED_SCHEMA,
  REVIEW_ATTENTION_LEVELS_V2,
  REVIEW_CAUSE_PHRASE_MAX_LENGTH,
  REVIEW_CAUSE_PHRASE_MAX_WORDS,
  REVIEW_CAUSE_PHRASE_PATTERN,
  REVIEW_NAMES_PERSON_V3,
  REVIEW_POLARITIES_V3,
  REVIEW_SENTIMENTS_V3,
  REVIEW_STRENGTHS_V3,
  REVIEW_STRENGTH_RANK_V3,
  REVIEW_URGENT_REASONS_V3,
  type ReviewAnalysisV3Stored,
  type ReviewAnalysisV3StoredMention,
  type ReviewNamesPersonV3,
  type ReviewPolarityV3,
  type ReviewSentimentV3,
  type ReviewStrengthV3,
  type ReviewUrgentReasonV3,
} from './review-analysis-v3'
import {
  REVIEW_NAME_TOKEN_RULES,
  collectReviewNameTokens,
  collectVocabularyHintWords,
  normalizeReviewCausePhrase,
  reviewCauseContainsRefusedName,
  reviewCauseReproducesQuotation,
} from './review-analysis-v3-cause-rules'
import { REVIEW_TOPICS_V3, type ReviewTopicV3 } from './review-topic-taxonomy'

export const REVIEW_ANALYSIS_NORMALIZATION_VERSION =
  'review-analysis-normalization-v1' as const

// `mention_dropped_cause` is no longer raised: a cause whose shape is invalid is emptied and
// its mention stays (`cause_refused_shape`). The flag stays in the closed vocabulary because
// the database check on a settled operation's flags lists it, and a row recorded under it
// must stay valid.
export const REVIEW_ANALYSIS_NORMALIZATION_FLAGS = Object.freeze([
  'mentions_capped',
  'sentence_refs_capped',
  'enum_case_repaired',
  'mention_dropped_malformed',
  'mention_dropped_enum',
  'mention_dropped_cause',
  'mention_dropped_sentences',
  'sentence_refs_repaired',
  'cause_refused_name',
  'cause_refused_quotation',
  'cause_refused_shape',
  'names_person_invalid',
  'names_person_raised',
  'mentions_merged',
  'urgent_reason_unknown',
] as const)

export type ReviewAnalysisNormalizationFlag =
  (typeof REVIEW_ANALYSIS_NORMALIZATION_FLAGS)[number]

const commonWordCatalogueSchema = z
  .object({
    version: z.literal('review-cause-common-words-v1'),
    words: z.array(z.string().regex(/^[a-z]{2,}$/)).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    for (let index = 0; index < value.words.length; index += 1) {
      const word = value.words[index]
      const previous = value.words[index - 1]
      if (previous !== undefined && word !== undefined && word <= previous) {
        context.addIssue({
          code: 'custom',
          path: ['words', index],
          message: 'common words must be sorted and unique',
        })
        return
      }
    }
  })

const commonWordCatalogue = commonWordCatalogueSchema.parse(commonWordSource)
const COMMON_WORDS = Object.freeze([...commonWordCatalogue.words])
const COMMON_WORD_SET = new Set<string>(COMMON_WORDS)

export const REVIEW_ANALYSIS_NORMALIZATION_MANIFEST = Object.freeze({
  version: REVIEW_ANALYSIS_NORMALIZATION_VERSION,
  limits: Object.freeze({
    mentions: REVIEW_ANALYSIS_V3_MAX_MENTIONS,
    sentenceReferences: REVIEW_ANALYSIS_V3_MAX_SENTENCE_REFS,
    sentenceNumber: REVIEW_ANALYSIS_V3_MAX_SENTENCE_NUMBER,
  }),
  causePatternSource: REVIEW_CAUSE_PHRASE_PATTERN.source,
  causePhraseMaximumWords: REVIEW_CAUSE_PHRASE_MAX_WORDS,
  causePhraseMaximumLength: REVIEW_CAUSE_PHRASE_MAX_LENGTH,
  // What an invalid cause does to its mention: the cause is emptied and the mention stays.
  invalidCausePolicy: 'empty-cause-keep-mention',
  quotationRunLength: 4,
  enumVocabularies: Object.freeze({
    topics: REVIEW_TOPICS_V3,
    sentiments: REVIEW_SENTIMENTS_V3,
    polarities: REVIEW_POLARITIES_V3,
    strengths: REVIEW_STRENGTHS_V3,
    namesPerson: REVIEW_NAMES_PERSON_V3,
    urgentReasons: REVIEW_URGENT_REASONS_V3,
    attentionLevels: REVIEW_ATTENTION_LEVELS_V2,
  }),
  normalizedDashCodePoints: Object.freeze([
    'U+2010',
    'U+2011',
    'U+2012',
    'U+2013',
    'U+2014',
    'U+2015',
    'U+2212',
    'U+FE58',
    'U+FE63',
    'U+FF0D',
  ]),
  personMarker: '[PERSON]',
  nameTokenRules: REVIEW_NAME_TOKEN_RULES,
  flags: REVIEW_ANALYSIS_NORMALIZATION_FLAGS,
  commonWordCatalogueVersion: commonWordCatalogue.version,
  commonWords: COMMON_WORDS,
})

export const REVIEW_ANALYSIS_NORMALIZATION_DIGEST = createHash('sha256')
  .update('repkey-review-analysis-normalization-v1\0', 'utf8')
  .update(canonicalizeRfc8785(REVIEW_ANALYSIS_NORMALIZATION_MANIFEST), 'utf8')
  .digest('hex')

/**
 * What the normalizer needs besides the provider's answer. `sentences` are exactly
 * what the provider read (sentence n is index n - 1); they, the name tokens found in
 * them and the extra tokens are ephemeral: nothing here is stored or logged.
 */
export type ReviewAnalysisV3NormalizationContext = Readonly<{
  sentences: readonly string[]
  vocabularyHints?: Partial<Record<ReviewTopicV3, readonly string[]>>
  extraNameTokens?: readonly string[]
}>

type NormalizedResult = Readonly<{
  status: 'normalized'
  answer: ReviewAnalysisV3Stored
  flags: readonly ReviewAnalysisNormalizationFlag[]
  droppedMentionCount: number
}>

type InvalidResult = Readonly<{
  status: 'output_invalid'
  reason:
    | 'answer_not_an_object'
    | 'sentiment_invalid'
    | 'mentions_not_an_array'
    | 'stored_contract_violated'
}>

type WorkingMention = {
  topic: ReviewTopicV3
  polarity: ReviewPolarityV3
  strength: ReviewStrengthV3
  thing: string | null
  issue: string | null
  sentences: number[]
  names_person: ReviewNamesPersonV3 | null
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function normalizeEnum<const Values extends readonly string[]>(
  value: unknown,
  vocabulary: Values,
):
  | Readonly<{ valid: true; value: Values[number]; changed: boolean }>
  | Readonly<{ valid: false }> {
  if (typeof value !== 'string') return { valid: false }
  const normalized = value.trim().toLowerCase()
  if (!(vocabulary as readonly string[]).includes(normalized)) return { valid: false }
  return {
    valid: true,
    value: normalized as Values[number],
    changed: normalized !== value,
  }
}

function normalizeSentenceReferences(
  value: unknown,
  sentenceCount: number,
  flags: Set<ReviewAnalysisNormalizationFlag>,
): readonly number[] | null {
  if (!Array.isArray(value)) return null
  if (value.length > REVIEW_ANALYSIS_V3_MAX_SENTENCE_REFS) {
    flags.add('sentence_refs_capped')
  }
  const selected = value.slice(0, REVIEW_ANALYSIS_V3_MAX_SENTENCE_REFS)
  const maximumSentenceNumber = Math.min(
    sentenceCount,
    REVIEW_ANALYSIS_V3_MAX_SENTENCE_NUMBER,
  )
  const accepted: number[] = []
  let removed = false
  for (const reference of selected) {
    const parsed =
      typeof reference === 'number' && Number.isInteger(reference)
        ? reference
        : typeof reference === 'string' && /^[0-9]+$/.test(reference)
          ? Number(reference)
          : null
    if (
      parsed === null ||
      !Number.isInteger(parsed) ||
      parsed < 1 ||
      parsed > maximumSentenceNumber
    ) {
      removed = true
      continue
    }
    accepted.push(parsed)
  }
  const uniqueInInputOrder = [...new Set(accepted)]
  if (uniqueInInputOrder.length !== accepted.length) removed = true
  const sorted = [...uniqueInInputOrder].sort((first, second) => first - second)
  const reordered = sorted.some((number, index) => number !== uniqueInInputOrder[index])
  if (removed || reordered) flags.add('sentence_refs_repaired')
  return sorted.length === 0 ? null : sorted
}

function normalizeNamesPerson(
  value: unknown,
  flags: Set<ReviewAnalysisNormalizationFlag>,
): ReviewNamesPersonV3 | null {
  if (value === null) return null
  const normalized = normalizeEnum(value, REVIEW_NAMES_PERSON_V3)
  if (!normalized.valid) {
    flags.add('names_person_invalid')
    return null
  }
  if (normalized.changed) flags.add('enum_case_repaired')
  return normalized.value
}

function addExtraNameTokens(target: Set<string>, tokens: readonly string[]): void {
  for (const token of tokens) {
    const normalized = token.normalize('NFKC').trim().toLowerCase()
    if (normalized.length === 0) continue
    target.add(normalized)
    for (const part of normalized.split(/['’-]/u)) {
      if (part.length > 0) target.add(part)
    }
  }
}

type CauseShape = Readonly<{
  thing: string | null
  issue: string | null
  shapeValid: boolean
}>

/**
 * A cause that is not one to three lowercase words of letters and hyphens, or a thing
 * with no issue, is refused as a whole and the mention stays as a topic-level mention,
 * as for a name or a quotation: the guest's topic is evidence, the phrase is not.
 */
function readCauseShape(rawThing: unknown, rawIssue: unknown): CauseShape {
  const thing = normalizeReviewCausePhrase(rawThing)
  const issue = normalizeReviewCausePhrase(rawIssue)
  if (!thing.valid || !issue.valid || (thing.value !== null && issue.value === null)) {
    return { thing: null, issue: null, shapeValid: false }
  }
  return { thing: thing.value, issue: issue.value, shapeValid: true }
}

function normalizeMention(
  raw: unknown,
  context: ReviewAnalysisV3NormalizationContext,
  nameTokens: ReadonlySet<string>,
  allowedWords: ReadonlySet<string>,
  reviewText: string,
  flags: Set<ReviewAnalysisNormalizationFlag>,
): WorkingMention | null {
  if (!isPlainObject(raw)) {
    flags.add('mention_dropped_malformed')
    return null
  }
  const topic = normalizeEnum(raw.topic, REVIEW_TOPICS_V3)
  const polarity = normalizeEnum(raw.polarity, REVIEW_POLARITIES_V3)
  const strength = normalizeEnum(raw.strength, REVIEW_STRENGTHS_V3)
  if (!topic.valid || !polarity.valid || !strength.valid) {
    flags.add('mention_dropped_enum')
    return null
  }
  if (topic.changed || polarity.changed || strength.changed) {
    flags.add('enum_case_repaired')
  }

  const sentences = normalizeSentenceReferences(
    raw.sentences,
    context.sentences.length,
    flags,
  )
  if (sentences === null) {
    flags.add('mention_dropped_sentences')
    return null
  }
  const namesPerson = normalizeNamesPerson(raw.names_person, flags)
  const cause = readCauseShape(raw.thing, raw.issue)
  if (!cause.shapeValid) flags.add('cause_refused_shape')
  let normalizedThing = cause.thing
  let normalizedIssue = cause.issue
  if (
    reviewCauseContainsRefusedName({
      thing: normalizedThing,
      issue: normalizedIssue,
      nameTokens,
      allowedWords,
    })
  ) {
    normalizedThing = null
    normalizedIssue = null
    flags.add('cause_refused_name')
  } else if (
    reviewCauseReproducesQuotation({
      thing: normalizedThing,
      issue: normalizedIssue,
      reviewText,
    })
  ) {
    normalizedThing = null
    normalizedIssue = null
    flags.add('cause_refused_quotation')
  }
  const raisedNamesPerson =
    namesPerson === null &&
    sentences.some((number) => context.sentences[number - 1]?.includes('[PERSON]'))
      ? 'other'
      : namesPerson
  if (raisedNamesPerson !== namesPerson) flags.add('names_person_raised')

  return {
    topic: topic.value,
    polarity: polarity.value,
    strength: strength.value,
    thing: normalizedThing,
    issue: normalizedIssue,
    sentences: [...sentences],
    names_person: raisedNamesPerson,
  }
}

function strongestNamesPerson(
  first: ReviewNamesPersonV3 | null,
  second: ReviewNamesPersonV3 | null,
): ReviewNamesPersonV3 | null {
  if (first === 'other' || second === 'other') return 'other'
  if (first === 'team_member' || second === 'team_member') return 'team_member'
  return null
}

/**
 * The sentence numbers two merged mentions cite, ascending and unique. Two mentions of
 * up to 16 numbers each can hold 32 together, and the stored contract holds 16: the
 * lowest 16 stay and the cut is reported, so a merge never turns a paid answer into
 * `output_invalid`.
 */
function unionSentenceReferences(
  first: readonly number[],
  second: readonly number[],
  flags: Set<ReviewAnalysisNormalizationFlag>,
): number[] {
  const union = [...new Set([...first, ...second])].sort(
    (earlier, later) => earlier - later,
  )
  if (union.length <= REVIEW_ANALYSIS_V3_MAX_SENTENCE_REFS) return union
  flags.add('sentence_refs_capped')
  return union.slice(0, REVIEW_ANALYSIS_V3_MAX_SENTENCE_REFS)
}

function mergeMentions(
  mentions: readonly WorkingMention[],
  flags: Set<ReviewAnalysisNormalizationFlag>,
): readonly WorkingMention[] {
  const merged: WorkingMention[] = []
  const indexByKey = new Map<string, number>()
  for (const mention of mentions) {
    const key = JSON.stringify([mention.topic, mention.thing, mention.polarity])
    const existingIndex = indexByKey.get(key)
    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length)
      merged.push({ ...mention, sentences: [...mention.sentences] })
      continue
    }
    const existing = merged[existingIndex]
    if (existing === undefined) continue
    flags.add('mentions_merged')
    const candidateIsStronger =
      REVIEW_STRENGTH_RANK_V3[mention.strength] >
      REVIEW_STRENGTH_RANK_V3[existing.strength]
    existing.sentences = unionSentenceReferences(
      existing.sentences,
      mention.sentences,
      flags,
    )
    if (candidateIsStronger) {
      existing.strength = mention.strength
      existing.issue = mention.issue
    }
    existing.names_person = strongestNamesPerson(
      existing.names_person,
      mention.names_person,
    )
  }
  return merged
}

function normalizeUrgent(
  value: unknown,
  flags: Set<ReviewAnalysisNormalizationFlag>,
): Readonly<{ reason: ReviewUrgentReasonV3 }> | null {
  if (value === null) return null
  if (!isPlainObject(value)) {
    flags.add('urgent_reason_unknown')
    return null
  }
  const reason = normalizeEnum(value.reason, REVIEW_URGENT_REASONS_V3)
  if (!reason.valid) {
    flags.add('urgent_reason_unknown')
    return null
  }
  if (reason.changed) flags.add('enum_case_repaired')
  return Object.freeze({ reason: reason.value })
}

function freezeMention(mention: WorkingMention): ReviewAnalysisV3StoredMention {
  return Object.freeze({
    ...mention,
    sentences: Object.freeze([...mention.sentences]),
  })
}

function freezeAnswer(
  sentiment: ReviewSentimentV3,
  mentions: readonly WorkingMention[],
  urgent: Readonly<{ reason: ReviewUrgentReasonV3 }> | null,
): ReviewAnalysisV3Stored {
  return Object.freeze({
    sentiment,
    mentions: Object.freeze(mentions.map(freezeMention)),
    urgent,
  })
}

export type ReviewAnalysisV3NormalizationResult = NormalizedResult | InvalidResult

function invalid(reason: InvalidResult['reason']): InvalidResult {
  return Object.freeze({ status: 'output_invalid', reason })
}

export function normalizeReviewAnalysisV3(
  raw: unknown,
  context: ReviewAnalysisV3NormalizationContext,
): ReviewAnalysisV3NormalizationResult {
  if (!isPlainObject(raw)) return invalid('answer_not_an_object')
  const flags = new Set<ReviewAnalysisNormalizationFlag>()
  const sentiment = normalizeEnum(raw.sentiment, REVIEW_SENTIMENTS_V3)
  if (!sentiment.valid) return invalid('sentiment_invalid')
  if (sentiment.changed) flags.add('enum_case_repaired')
  if (!Array.isArray(raw.mentions)) return invalid('mentions_not_an_array')
  if (raw.mentions.length > REVIEW_ANALYSIS_V3_MAX_MENTIONS) {
    flags.add('mentions_capped')
  }

  const nameTokens = new Set(collectReviewNameTokens(context.sentences))
  addExtraNameTokens(nameTokens, context.extraNameTokens ?? [])
  const allowedWords = new Set(COMMON_WORD_SET)
  for (const word of collectVocabularyHintWords(context.vocabularyHints)) {
    allowedWords.add(word)
  }
  const reviewText = context.sentences.join(' ')
  const normalizedMentions: WorkingMention[] = []
  let droppedMentionCount = 0
  for (const mention of raw.mentions.slice(0, REVIEW_ANALYSIS_V3_MAX_MENTIONS)) {
    const normalized = normalizeMention(
      mention,
      context,
      nameTokens,
      allowedWords,
      reviewText,
      flags,
    )
    if (normalized === null) droppedMentionCount += 1
    else normalizedMentions.push(normalized)
  }
  const mentions = mergeMentions(normalizedMentions, flags)
  const urgent = normalizeUrgent(raw.urgent, flags)
  const answer = freezeAnswer(sentiment.value, mentions, urgent)
  if (!REVIEW_ANALYSIS_V3_STORED_SCHEMA.safeParse(answer).success) {
    return invalid('stored_contract_violated')
  }
  return Object.freeze({
    status: 'normalized',
    answer,
    flags: Object.freeze([...flags].sort()),
    droppedMentionCount,
  })
}
