import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod/v4'
import {
  AI_OPERATION_PROFILES,
  AI_PROVIDER_DEPLOYMENT_PROFILE,
} from './ai-operation-profiles'
import { AI_ROUTE_OUTPUT_JSON_SCHEMAS } from './ai-route-output-schemas'
import { AI_RUNTIME_CAPABILITIES_V1 } from './ai-runtime-capability-contract'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import {
  REVIEW_ANALYSIS_V3_MAX_MENTIONS,
  REVIEW_ANALYSIS_V3_MAX_SENTENCE_NUMBER,
  REVIEW_ANALYSIS_V3_MAX_SENTENCE_REFS,
  REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA,
  REVIEW_ANALYSIS_V3_STORED_SCHEMA,
  REVIEW_ANALYSIS_V3_VERSIONS,
  REVIEW_ATTENTION_LEVELS_V2,
  REVIEW_ATTENTION_V2_DIGEST,
  REVIEW_ATTENTION_V2_RULES_MANIFEST,
  REVIEW_ATTENTION_V2_VERSION,
  REVIEW_CAUSE_PHRASE_MAX_LENGTH,
  REVIEW_CAUSE_PHRASE_MAX_WORDS,
  REVIEW_CAUSE_PHRASE_PATTERN,
  REVIEW_NAMES_PERSON_V3,
  REVIEW_POLARITIES_V3,
  REVIEW_SENTIMENTS_V3,
  REVIEW_STRENGTHS_V3,
  REVIEW_STRENGTH_RANK_V3,
  REVIEW_URGENT_REASONS_V3,
  deriveReviewAttentionV2,
  strongerReviewStrengthV3,
  type DeriveReviewAttentionV2Input,
  type ReviewAnalysisV3ProviderAnswer,
  type ReviewAnalysisV3Stored,
  type ReviewAnalysisV3StoredMention,
  type ReviewAttentionLevelV2,
  type ReviewNamesPersonV3,
  type ReviewPolarityV3,
  type ReviewSentimentV3,
  type ReviewStrengthV3,
  type ReviewUrgentReasonV3,
} from './review-analysis-v3'
import { REVIEW_SENTENCES_VERSION } from './review-sentences'
import { REVIEW_TOPICS_V3, REVIEW_TOPIC_TAXONOMY_VERSION } from './review-topic-taxonomy'

const cleanMention: ReviewAnalysisV3StoredMention = {
  topic: 'facilities_equipment',
  polarity: 'negative',
  strength: 'clear',
  thing: 'air conditioning',
  issue: 'not working',
  sentences: [1, 2],
  names_person: null,
}

const cleanAnswer: ReviewAnalysisV3ProviderAnswer = {
  sentiment: 'negative',
  mentions: [cleanMention],
  urgent: null,
}

describe('review analysis v3 vocabularies and limits', () => {
  it('pins every closed vocabulary and its public type', () => {
    const sentiment: ReviewSentimentV3 = 'mixed'
    const polarity: ReviewPolarityV3 = 'negative'
    const strength: ReviewStrengthV3 = 'strong'
    const namesPerson: ReviewNamesPersonV3 = 'other'
    const urgent: ReviewUrgentReasonV3 = 'legal_threat'
    const attention: ReviewAttentionLevelV2 = 'high'
    expect({ sentiment, polarity, strength, namesPerson, urgent, attention }).toEqual({
      sentiment: 'mixed',
      polarity: 'negative',
      strength: 'strong',
      namesPerson: 'other',
      urgent: 'legal_threat',
      attention: 'high',
    })
    expect(REVIEW_SENTIMENTS_V3).toEqual(['positive', 'neutral', 'negative', 'mixed'])
    expect(REVIEW_POLARITIES_V3).toEqual(['positive', 'neutral', 'negative'])
    expect(REVIEW_STRENGTHS_V3).toEqual(['mild', 'clear', 'strong'])
    expect(REVIEW_NAMES_PERSON_V3).toEqual(['team_member', 'other'])
    expect(REVIEW_URGENT_REASONS_V3).toEqual([
      'safety',
      'health',
      'discrimination',
      'legal_threat',
    ])
    expect(REVIEW_ATTENTION_LEVELS_V2).toEqual(['urgent', 'high', 'medium', 'low'])
    for (const catalogue of [
      REVIEW_SENTIMENTS_V3,
      REVIEW_POLARITIES_V3,
      REVIEW_STRENGTHS_V3,
      REVIEW_NAMES_PERSON_V3,
      REVIEW_URGENT_REASONS_V3,
      REVIEW_ATTENTION_LEVELS_V2,
    ]) {
      expect(Object.isFrozen(catalogue)).toBe(true)
    }
  })

  it('pins strength order and preserves the first value on a tie', () => {
    expect(REVIEW_STRENGTH_RANK_V3).toEqual({ mild: 0, clear: 1, strong: 2 })
    expect(strongerReviewStrengthV3('mild', 'clear')).toBe('clear')
    expect(strongerReviewStrengthV3('strong', 'clear')).toBe('strong')
    expect(strongerReviewStrengthV3('clear', 'clear')).toBe('clear')
    expect(Object.isFrozen(REVIEW_STRENGTH_RANK_V3)).toBe(true)
  })

  it('pins provider and cause bounds', () => {
    expect(REVIEW_ANALYSIS_V3_MAX_MENTIONS).toBe(48)
    expect(REVIEW_ANALYSIS_V3_MAX_SENTENCE_REFS).toBe(16)
    expect(REVIEW_ANALYSIS_V3_MAX_SENTENCE_NUMBER).toBe(10_000)
    expect(REVIEW_CAUSE_PHRASE_MAX_WORDS).toBe(3)
    expect(REVIEW_CAUSE_PHRASE_MAX_LENGTH).toBe(80)
    expect(REVIEW_CAUSE_PHRASE_PATTERN.source).toBe(
      '^[a-z]+(?:-[a-z]+)*(?: [a-z]+(?:-[a-z]+)*){0,2}$',
    )
  })
})

describe('review analysis v3 schemas', () => {
  it('accepts a strict clean answer and zero mentions', () => {
    const stored: ReviewAnalysisV3Stored = cleanAnswer
    expect(REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA.safeParse(cleanAnswer).success).toBe(
      true,
    )
    expect(REVIEW_ANALYSIS_V3_STORED_SCHEMA.safeParse(stored).success).toBe(true)
    expect(
      REVIEW_ANALYSIS_V3_STORED_SCHEMA.safeParse({
        sentiment: 'neutral',
        mentions: [],
        urgent: null,
      }).success,
    ).toBe(true)
    expect(
      REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA.safeParse({
        ...cleanAnswer,
        id: 'invented-review-1',
      }).success,
    ).toBe(false)
  })

  it('holds a provider cause to the stored shape, and leaves the cross-field rules to the stored schema', () => {
    const badShape = [
      { ...cleanMention, thing: 'Air Conditioning' },
      { ...cleanMention, thing: 'room 2' },
      { ...cleanMention, thing: 'one two three four' },
      { ...cleanMention, thing: 'a'.repeat(81) },
      { ...cleanMention, issue: "didn't work" },
      { ...cleanMention, issue: 'cold, wet' },
      { ...cleanMention, issue: '30-minute wait' },
      { ...cleanMention, issue: 'failed/broken' },
      { ...cleanMention, issue: '' },
    ]
    for (const mention of badShape) {
      const answer = { ...cleanAnswer, mentions: [mention] }
      expect(REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA.safeParse(answer).success).toBe(
        false,
      )
      expect(REVIEW_ANALYSIS_V3_STORED_SCHEMA.safeParse(answer).success).toBe(false)
    }
    // What a provider can express and the stored contract refuses: a thing with no issue,
    // and sentence numbers out of order or repeated. The normalizer repairs these.
    const structural = [
      { ...cleanMention, issue: null },
      { ...cleanMention, sentences: [2, 1] },
      { ...cleanMention, sentences: [1, 1] },
    ]
    for (const mention of structural) {
      const answer = { ...cleanAnswer, mentions: [mention] }
      expect(REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA.safeParse(answer).success).toBe(
        true,
      )
      expect(REVIEW_ANALYSIS_V3_STORED_SCHEMA.safeParse(answer).success).toBe(false)
    }
  })

  it('accepts the phrases the pattern allows: hyphenated words, one to three words, or null', () => {
    for (const phrase of [
      'engine',
      'check-in',
      'check-in desk',
      'air conditioning',
      'self-service check-in desk',
      null,
    ]) {
      const answer = {
        ...cleanAnswer,
        mentions: [
          { ...cleanMention, thing: phrase, issue: phrase === null ? null : 'slow' },
        ],
      }
      expect(REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA.safeParse(answer).success).toBe(
        true,
      )
    }
  })

  it('sends the cause pattern to the provider as part of the strict wire schema', () => {
    const wire = AI_ROUTE_OUTPUT_JSON_SCHEMAS['review-analysis-v3'] as unknown as {
      properties: {
        mentions: {
          items: {
            properties: Record<string, { anyOf: readonly Record<string, unknown>[] }>
          }
        }
      }
    }
    const mention = wire.properties.mentions.items.properties
    for (const field of ['thing', 'issue'] as const) {
      expect(mention[field]?.anyOf).toEqual([
        { type: 'string', maxLength: 80, pattern: REVIEW_CAUSE_PHRASE_PATTERN.source },
        { type: 'null' },
      ])
    }
  })

  it('rejects duplicate stored mention identities but allows them from a provider', () => {
    const answer = {
      ...cleanAnswer,
      mentions: [
        cleanMention,
        { ...cleanMention, strength: 'strong', issue: 'very weak' },
      ],
    }
    expect(REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA.safeParse(answer).success).toBe(true)
    expect(REVIEW_ANALYSIS_V3_STORED_SCHEMA.safeParse(answer).success).toBe(false)
  })

  it('requires every provider field and enforces all array and integer bounds', () => {
    const withoutNames = {
      ...cleanAnswer,
      mentions: [
        {
          topic: cleanMention.topic,
          polarity: cleanMention.polarity,
          strength: cleanMention.strength,
          thing: cleanMention.thing,
          issue: cleanMention.issue,
          sentences: cleanMention.sentences,
        },
      ],
    }
    expect(
      REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA.safeParse(withoutNames).success,
    ).toBe(false)
    expect(
      REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA.safeParse({
        ...cleanAnswer,
        mentions: Array.from({ length: 49 }, () => cleanMention),
      }).success,
    ).toBe(false)
    for (const sentences of [
      [],
      Array.from({ length: 17 }, (_value, index) => index + 1),
      [0],
      [10_001],
      [1.5],
    ]) {
      expect(
        REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA.safeParse({
          ...cleanAnswer,
          mentions: [{ ...cleanMention, sentences }],
        }).success,
      ).toBe(false)
    }
  })
})

type Mutable<Value> = Value extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: Mutable<Value[Key]> }
    : Value

describe('review analysis v3 types', () => {
  it('keep the hand-written types in step with what the schemas accept', () => {
    // These assignments compile only while the exported types and the schemas
    // accept each other's values, so a drift between them fails the type check.
    const fromProviderSchema: ReviewAnalysisV3ProviderAnswer =
      REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA.parse(cleanAnswer)
    const fromStoredSchema: ReviewAnalysisV3Stored =
      REVIEW_ANALYSIS_V3_STORED_SCHEMA.parse(cleanAnswer)
    const toProviderSchema: z.input<typeof REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA> =
      structuredClone(cleanAnswer) as Mutable<ReviewAnalysisV3ProviderAnswer>
    const toStoredSchema: z.input<typeof REVIEW_ANALYSIS_V3_STORED_SCHEMA> =
      structuredClone(cleanAnswer) as Mutable<ReviewAnalysisV3Stored>
    for (const parsed of [
      fromProviderSchema,
      fromStoredSchema,
      toProviderSchema,
      toStoredSchema,
    ]) {
      expect(parsed).toEqual(cleanAnswer)
    }
  })
})

describe('review attention v2', () => {
  const mention = (
    polarity: ReviewPolarityV3,
    strength: ReviewStrengthV3,
  ): Pick<ReviewAnalysisV3StoredMention, 'polarity' | 'strength'> => ({
    polarity,
    strength,
  })

  const rows: readonly [string, DeriveReviewAttentionV2Input, ReviewAttentionLevelV2][] =
    [
      [
        'urgent safety',
        { rating: 5, sentiment: 'positive', urgent: { reason: 'safety' }, mentions: [] },
        'urgent',
      ],
      [
        'urgent health',
        { rating: 3, sentiment: 'neutral', urgent: { reason: 'health' }, mentions: [] },
        'urgent',
      ],
      [
        'urgent discrimination',
        {
          rating: 4,
          sentiment: 'mixed',
          urgent: { reason: 'discrimination' },
          mentions: [],
        },
        'urgent',
      ],
      [
        'urgent legal threat',
        {
          rating: 1,
          sentiment: 'negative',
          urgent: { reason: 'legal_threat' },
          mentions: [],
        },
        'urgent',
      ],
      [
        'clear complaint',
        {
          rating: 5,
          sentiment: 'positive',
          urgent: null,
          mentions: [mention('negative', 'clear')],
        },
        'high',
      ],
      [
        'strong complaint',
        {
          rating: 5,
          sentiment: 'neutral',
          urgent: null,
          mentions: [mention('negative', 'strong')],
        },
        'high',
      ],
      [
        'rating one neutral',
        { rating: 1, sentiment: 'neutral', urgent: null, mentions: [] },
        'high',
      ],
      [
        'rating two mixed',
        { rating: 2, sentiment: 'mixed', urgent: null, mentions: [] },
        'high',
      ],
      [
        'rating two negative',
        { rating: 2, sentiment: 'negative', urgent: null, mentions: [] },
        'high',
      ],
      [
        'rating two positive exception',
        { rating: 2, sentiment: 'positive', urgent: null, mentions: [] },
        'low',
      ],
      [
        'positive exception with mild complaint',
        {
          rating: 1,
          sentiment: 'positive',
          urgent: null,
          mentions: [mention('negative', 'mild')],
        },
        'medium',
      ],
      [
        'rating three negative sentiment',
        { rating: 3, sentiment: 'negative', urgent: null, mentions: [] },
        'medium',
      ],
      [
        'rating five negative sentiment',
        { rating: 5, sentiment: 'negative', urgent: null, mentions: [] },
        'medium',
      ],
      [
        'mixed sentiment',
        { rating: 5, sentiment: 'mixed', urgent: null, mentions: [] },
        'medium',
      ],
      [
        'mild complaint',
        {
          rating: 5,
          sentiment: 'positive',
          urgent: null,
          mentions: [mention('negative', 'mild')],
        },
        'medium',
      ],
      [
        'mild complaint under neutral',
        {
          rating: 3,
          sentiment: 'neutral',
          urgent: null,
          mentions: [mention('negative', 'mild')],
        },
        'medium',
      ],
      [
        'clear praise only',
        {
          rating: 5,
          sentiment: 'positive',
          urgent: null,
          mentions: [mention('positive', 'clear')],
        },
        'low',
      ],
      [
        'neutral mention only',
        {
          rating: 3,
          sentiment: 'neutral',
          urgent: null,
          mentions: [mention('neutral', 'strong')],
        },
        'low',
      ],
      [
        'zero mentions positive',
        { rating: 5, sentiment: 'positive', urgent: null, mentions: [] },
        'low',
      ],
      [
        'zero mentions neutral',
        { rating: 3, sentiment: 'neutral', urgent: null, mentions: [] },
        'low',
      ],
      [
        'rating above scale remains total',
        { rating: 9, sentiment: 'positive', urgent: null, mentions: [] },
        'low',
      ],
      [
        'rating below scale follows threshold',
        { rating: 0, sentiment: 'neutral', urgent: null, mentions: [] },
        'high',
      ],
    ]

  it.each(rows)('%s derives %s', (_name, input, expected) => {
    expect(deriveReviewAttentionV2(input)).toBe(expected)
  })

  it('pins the governed attention rules and digest', () => {
    expect(REVIEW_ATTENTION_V2_VERSION).toBe('review-attention-v2')
    expect(REVIEW_ATTENTION_V2_RULES_MANIFEST).toEqual({
      version: 'review-attention-v2',
      levels: ['urgent', 'high', 'medium', 'low'],
      rules: [
        'urgent when an urgent reason is present',
        'high for a clear or strong negative mention, or a rating at most two unless positive',
        'medium for mixed or negative sentiment, or any remaining negative mention',
        'low otherwise',
      ],
    })
    expect(Object.isFrozen(REVIEW_ATTENTION_V2_RULES_MANIFEST)).toBe(true)
    expect(Object.isFrozen(REVIEW_ATTENTION_V2_RULES_MANIFEST.rules)).toBe(true)
    expect(REVIEW_ATTENTION_V2_DIGEST).toBe(
      '42473e84ab5b376cd06940ac4060b7e8c875100507247c91e70450d220bed687',
    )
    expect(REVIEW_ATTENTION_V2_DIGEST).toBe(
      createHash('sha256')
        .update('repkey-review-attention-v2\0', 'utf8')
        .update(canonicalizeRfc8785(REVIEW_ATTENTION_V2_RULES_MANIFEST), 'utf8')
        .digest('hex'),
    )
  })
})

describe('review analysis v3 version set is the served one', () => {
  it('pins every new logical identifier and agrees with sibling contracts', () => {
    expect(REVIEW_ANALYSIS_V3_VERSIONS).toEqual({
      topicTaxonomy: 'review-topic-taxonomy-v3',
      analysisOperation: 'review-analysis-v3',
      capabilityRuntime: 'review-analysis-runtime-v2',
      gatewayProfile: 'review-analysis-gateway-v2',
      normalizer: 'review-analysis-normalization-v1',
      sentenceRules: 'review-sentences-v1',
      attentionFormula: 'review-attention-v2',
      vocabularyCatalogue: 'review-vocabulary-hints-v1',
      issueNormalization: 'property-issue-normalization-v1',
      providerDeployment: 'private-beta-global-v2',
      guestVoiceReadModel: 'guest-voice-read-v2',
    })
    expect(REVIEW_ANALYSIS_V3_VERSIONS.topicTaxonomy).toBe(REVIEW_TOPIC_TAXONOMY_VERSION)
    expect(REVIEW_ANALYSIS_V3_VERSIONS.sentenceRules).toBe(REVIEW_SENTENCES_VERSION)
    expect(REVIEW_ANALYSIS_V3_VERSIONS.attentionFormula).toBe(REVIEW_ATTENTION_V2_VERSION)
    expect(Object.isFrozen(REVIEW_ANALYSIS_V3_VERSIONS)).toBe(true)
  })

  it('is what both live catalogues serve for review analysis, under the deployment profile that names both providers', () => {
    expect(
      AI_OPERATION_PROFILES.filter(
        (profile) =>
          profile.profileVersion === REVIEW_ANALYSIS_V3_VERSIONS.analysisOperation,
      ),
    ).toHaveLength(1)
    const live = AI_RUNTIME_CAPABILITIES_V1.find(
      (entry) => entry.capability === 'review_analysis',
    )
    expect(live).toMatchObject({
      runtimeProfileVersion: REVIEW_ANALYSIS_V3_VERSIONS.capabilityRuntime,
      gatewayProfileVersion: REVIEW_ANALYSIS_V3_VERSIONS.gatewayProfile,
      operationProfileVersion: REVIEW_ANALYSIS_V3_VERSIONS.analysisOperation,
      providerDeploymentProfileVersion: REVIEW_ANALYSIS_V3_VERSIONS.providerDeployment,
    })
    // The version set, the catalogue and the deployment profile are three spellings of
    // one name; the identity context spells it a fourth time for the browser.
    expect(AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion).toBe(
      REVIEW_ANALYSIS_V3_VERSIONS.providerDeployment,
    )
  })

  it('keeps all twelve topics available to the provider schema', () => {
    for (const topic of REVIEW_TOPICS_V3) {
      expect(
        REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA.safeParse({
          ...cleanAnswer,
          mentions: [{ ...cleanMention, topic }],
        }).success,
      ).toBe(true)
    }
  })
})
