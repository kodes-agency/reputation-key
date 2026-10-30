import { createHash } from 'node:crypto'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import type { AiReasoningEffortV1 } from './ai-openai-request-contract'
import type { MerchantAiCapability } from './domain/merchant-ai-capability'

// The provider-free half of an operation profile (contract sections 2.1 and 7.1).
//
// An operation profile used to hash its prompt and schema together with OpenAI's
// request shape and the token count of OpenAI's wrapper around them, so a second
// provider could not share a profile with the first. The logical profile keeps
// what the operation IS: its prompt, the schema of its answer, the artifacts it
// reads (taxonomy, sentence rules, normalizer, attention formula, source rules)
// and its limits. Its digest moves when any of those moves and for nothing a
// provider does. How a provider carries it (the request shape, the SDK, the
// headers, the price, the wire schema, the tokens before the first payload byte)
// is that provider's attestation and its pairing with this profile
// (`ai-provider-attestations.ts`).

export type LogicalOperationLimits = Readonly<{
  sourceByteLimit: number
  providerPayloadByteLimit: number
  preparedRequestByteLimit: number
  responseByteLimit: number
  maxOutputTokens: number
  reasoningEffort: AiReasoningEffortV1
  providerDeadlineMs: number
  requestDeadlineMs: number
  executionLeaseMs: number
}>

export type LogicalOperationProfileSource = Readonly<{
  profileVersion: string
  command: 'analysis' | 'reply' | 'trend' | 'synthetic_canary'
  capability: MerchantAiCapability | null
  purpose: 'ai.analyze' | 'ai.generate_reply' | 'ai.detect_trends' | 'ai.synthetic_canary'
  sourceRoute:
    'review-analysis' | 'reply-suggestion' | 'property-trend' | 'synthetic-canary'
  gatewayPath:
    | '/v1/review-analysis'
    | '/v1/reply-suggestion'
    | '/v1/property-trend'
    | 'internal:synthetic-canary'
  callerRole: 'web' | 'worker' | 'release_canary'
  capabilityRuntimeProfileVersion: string | null
  providerDeploymentProfileVersion: string
  outputSchemaName: string
  /** The JSON Schema of the provider answer, in the closed form every provider derives from. */
  outputSchema: Readonly<Record<string, unknown>>
  developerPrompt: string
  /** Versions and digests of everything the operation reads that is not a provider. */
  logicalArtifacts: Readonly<Record<string, unknown>>
  limits: LogicalOperationLimits
}>

export type LogicalOperationProfile = LogicalOperationProfileSource &
  Readonly<{
    outputSchemaDigest: string
    promptDigest: string
    logicalArtifactsDigest: string
    /** Over every field above and nothing a provider adds. */
    logicalDigest: string
  }>

function digest(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(domain, 'utf8')
    .update(canonicalizeRfc8785(value), 'utf8')
    .digest('hex')
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

export function defineLogicalOperationProfile(
  source: LogicalOperationProfileSource,
): LogicalOperationProfile {
  const outputSchema = JSON.parse(canonicalizeRfc8785(source.outputSchema)) as Readonly<
    Record<string, unknown>
  >
  // Same domains as the legacy profile, so the schema and prompt digests of a
  // profile do not change when it is seen through this one.
  const outputSchemaDigest = digest('repkey-ai-output-schema-v1\0', outputSchema)
  const promptDigest = digest('repkey-ai-developer-prompt-v1\0', source.developerPrompt)
  const logicalArtifacts = JSON.parse(
    canonicalizeRfc8785(source.logicalArtifacts),
  ) as Readonly<Record<string, unknown>>
  const logicalArtifactsDigest = digest(
    'repkey-ai-logical-artifacts-v1\0',
    logicalArtifacts,
  )
  const {
    outputSchema: _outputSchema,
    developerPrompt: _developerPrompt,
    logicalArtifacts: _logicalArtifacts,
    ...persisted
  } = source
  const logicalDigest = digest('repkey-ai-logical-operation-profile-v1\0', {
    ...persisted,
    outputSchemaDigest,
    promptDigest,
    logicalArtifactsDigest,
  })
  return deepFreeze({
    ...source,
    outputSchema,
    logicalArtifacts,
    outputSchemaDigest,
    promptDigest,
    logicalArtifactsDigest,
    logicalDigest,
  })
}
