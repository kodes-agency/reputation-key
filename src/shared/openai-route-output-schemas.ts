import { z } from 'zod'

export const AI_SENTIMENTS = Object.freeze([
  'positive',
  'neutral',
  'negative',
  'mixed',
] as const)
export const AI_PRIMARY_CATEGORIES = Object.freeze([
  'service',
  'staff',
  'quality',
  'value',
  'cleanliness',
  'wait_time',
  'atmosphere',
  'location',
  'accessibility',
  'other',
] as const)
export const AI_URGENCY_SIGNALS = Object.freeze([
  'safety',
  'health',
  'discrimination',
  'legal',
  'fraud',
  'service_failure',
] as const)
export const AI_REPLY_TEMPLATE_IDS = Object.freeze([
  'appreciation_positive',
  'appreciation_neutral',
  'recovery_service',
  'acknowledge_concern',
] as const)

// Anchored finite alternatives with bounded suffixes; no overlapping repetition.
export const CONCRETE_REPLY_LANGUAGE_PATTERN =
  // eslint-disable-next-line security/detect-unsafe-regex
  /^(?:(?:en|es|fr|de|pt|it|nl|pl|tr|vi|id)-Latn|(?:uk|ru)-Cyrl|ar-Arab|he-Hebr|hi-Deva|bn-Beng|ta-Taml|th-Thai|zh-(?:Hans|Hant)|ja-Jpan|ko-Kore)(?:-(?:[A-Z]{2}|[0-9]{3}))?$/

// Anchored finite controlled vocabulary; every branch has a fixed terminal suffix.
export const TREND_SIGNAL_PATTERN =
  /^(?:sentiment\.(?:positive|neutral|negative|mixed)\.(?:up|down)|attention\.(?:urgent|high|medium|low)\.(?:up|down)|category\.(?:service|staff|quality|value|cleanliness|wait_time|atmosphere|location|accessibility|other)\.(?:up|down)|valence\.overall\.(?:up|down))$/

function addUniqueIssue(values: readonly string[], context: z.RefinementCtx): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: 'custom', message: 'array values must be unique' })
  }
}

export const AI_ANALYSIS_OUTPUT_SCHEMA = z
  .object({
    sentiment: z.enum(AI_SENTIMENTS),
    sentimentValence: z.number().int().min(-100).max(100),
    primaryCategory: z.enum(AI_PRIMARY_CATEGORIES),
    urgencySignals: z.array(z.enum(AI_URGENCY_SIGNALS)).max(3),
  })
  .strict()
  .superRefine((value, context) => {
    addUniqueIssue(value.urgencySignals, context)
    const valid =
      value.sentiment === 'mixed' ||
      (value.sentiment === 'positive' && value.sentimentValence >= 20) ||
      (value.sentiment === 'neutral' &&
        value.sentimentValence >= -19 &&
        value.sentimentValence <= 19) ||
      (value.sentiment === 'negative' && value.sentimentValence <= -20)
    if (!valid)
      context.addIssue({ code: 'custom', message: 'sentiment valence is inconsistent' })
  })

export const AI_REPLY_SELECTION_OUTPUT_SCHEMA = z
  .object({
    templateId: z.enum(AI_REPLY_TEMPLATE_IDS),
    languageCode: z.string().regex(CONCRETE_REPLY_LANGUAGE_PATTERN),
  })
  .strict()

export const AI_TREND_SELECTION_OUTPUT_SCHEMA = z
  .object({
    selectedSignalIds: z.array(z.string().regex(TREND_SIGNAL_PATTERN)).min(1).max(4),
  })
  .strict()
  .superRefine((value, context) => addUniqueIssue(value.selectedSignalIds, context))

export const AI_SYNTHETIC_CANARY_OUTPUT_SCHEMA = z
  .object({
    marker: z.literal('synthetic_canary_ok'),
  })
  .strict()

/**
 * This is the provider-neutral authority for persisted structured-output schemas.
 * The schemas are strict Zod v4 objects, so their draft-7 conversion is already in
 * the closed form consumed by the OpenAI SDK strict transform (root object, every
 * property required, and additionalProperties:false). A changed SDK transform is
 * caught by the package-contract test before a profile digest can be released.
 */
export function deriveAiRouteOutputJsonSchema(
  schema: z.ZodType,
): ReturnType<typeof z.toJSONSchema> {
  const generated = z.toJSONSchema(schema, { target: 'draft-7' })
  const serialized = JSON.stringify(generated)
  if (serialized === undefined) {
    throw new TypeError('AI route output schema is not closed JSON')
  }
  return JSON.parse(serialized) as ReturnType<typeof z.toJSONSchema>
}

export const AI_ROUTE_OUTPUT_JSON_SCHEMAS = Object.freeze({
  'review-analysis': deriveAiRouteOutputJsonSchema(AI_ANALYSIS_OUTPUT_SCHEMA),
  'reply-suggestion': deriveAiRouteOutputJsonSchema(AI_REPLY_SELECTION_OUTPUT_SCHEMA),
  'property-trend': deriveAiRouteOutputJsonSchema(AI_TREND_SELECTION_OUTPUT_SCHEMA),
  'synthetic-canary': deriveAiRouteOutputJsonSchema(AI_SYNTHETIC_CANARY_OUTPUT_SCHEMA),
})

export type AiAnalysisOutput = z.infer<typeof AI_ANALYSIS_OUTPUT_SCHEMA>
export type AiReplySelectionOutput = z.infer<typeof AI_REPLY_SELECTION_OUTPUT_SCHEMA>
export type AiTrendSelectionOutput = z.infer<typeof AI_TREND_SELECTION_OUTPUT_SCHEMA>
export type AiSyntheticCanaryOutput = z.infer<typeof AI_SYNTHETIC_CANARY_OUTPUT_SCHEMA>
