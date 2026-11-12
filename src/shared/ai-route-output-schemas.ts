import { replyDraftingV2OutputSchema } from './reply-drafting-v2-schema'
import { z } from 'zod/v4'
import { REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA } from './review-analysis-v3'

export const AI_SYNTHETIC_CANARY_OUTPUT_SCHEMA = z
  .object({
    // A single-value ENUM, not `z.literal`: literal derives JSON Schema
    // `{ const: … }` with no `type`, and OpenAI Structured Outputs rejects the
    // whole request with 400 `invalid_json_schema` ("schema must have a 'type'
    // key"). That 400 surfaced as `output_invalid`, so the release canary could
    // never pass and no AI capability could ever be un-killed.
    marker: z.enum(['synthetic_canary_ok']),
  })
  .strict()

/**
 * This is the provider-neutral authority for persisted structured-output schemas.
 * The schemas are strict Zod v4 objects, so their draft-7 conversion is already in
 * the closed form consumed by the OpenAI SDK strict transform (root object, every
 * property required, and additionalProperties:false). A changed SDK transform is
 * caught by the package-contract test before a profile digest can be released.
 */
function deriveAiRouteOutputJsonSchema(
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
  'review-analysis-v3': deriveAiRouteOutputJsonSchema(
    REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA,
  ),
  'reply-suggestion-v2': deriveAiRouteOutputJsonSchema(replyDraftingV2OutputSchema),
  'synthetic-canary': deriveAiRouteOutputJsonSchema(AI_SYNTHETIC_CANARY_OUTPUT_SCHEMA),
})

export type AiSyntheticCanaryOutput = z.infer<typeof AI_SYNTHETIC_CANARY_OUTPUT_SCHEMA>
