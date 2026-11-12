import { digestOf } from '#/shared/ai-digest'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'
import { AI_STRUCTURED_MARKER_DETECTORS_DIGEST } from '#/shared/ai-structured-marker-detectors'
import { AI_REDACTION_PROFILE_DIGEST } from '#/shared/ai-deterministic-redactor'
import { LANGUAGE_CATALOGUE_DIGEST } from '#/shared/ai-review-language-catalogue'
import { OPENAI_REQUEST_SHAPE_V1_DIGEST } from '#/shared/ai-openai-provider-profile'
import {
  renderOpenAiStaticTokenBearingMaterial,
  type AiReasoningEffortV1,
} from '#/shared/ai-openai-request-contract'
import { REPLY_STREAM_SDK_ATTESTATION } from '#/shared/ai-openai-stream-profile'
import { openAiAttestationOf } from '#/shared/ai-openai-provider-attestation'
import { AI_SOURCE_CANONICALIZER_PROFILE_V1 } from '#/shared/ai-source-profile'
import type { AiOperationProviderPairing } from '#/shared/ai-provider-attestations'

// An operation profile, in one module. A profile is defined once, in no provider's
// terms (`defineLogicalOperationProfile`): its prompt, the schema of its answer, the
// artifacts it reads and its limits, sealed by a digest that moves for nothing a
// provider does. The catalogue entry a provider serves it as
// (`operationProfileForCatalogue`) adds that provider's request shape and the tokens
// its wrapper holds before the first payload byte, and seals them with the same
// digest rule. Every digest here is `digestOf(domain, value)`: SHA-256 over the
// domain, then the RFC 8785 form of the value.

export { AI_SOURCE_CANONICALIZER_PROFILE_V1 }

function deepFreeze<Value>(value: Value): Value {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

export const PROPERTY_CALENDAR_ATTESTATION = Object.freeze({
  profileVersion: 'property-calendar-v1',
  epochMillisFunction: 'ai_epoch_millis_v1',
  localCalendarFunction: 'ai_property_local_date_v1',
  localMidnightFunction: 'ai_property_local_midnight_v1',
  databaseImageDigest: '33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20',
  testedPostgresMajorVersions: Object.freeze([16]),
})

const SDK_ATTESTATION = Object.freeze({
  requestShapeVersion: 'openai-responses-request-shape-v1',
  requestShapeDigest: OPENAI_REQUEST_SHAPE_V1_DIGEST,
  providerTransportProfile: 'openai-provider-transport-v1',
})

export const REVIEW_SOURCE_ATTESTATION = Object.freeze({
  ...AI_SOURCE_CANONICALIZER_PROFILE_V1,
  redactionProfileVersion: 'gbp-review-global-v1',
  redactionProfileDigest: AI_REDACTION_PROFILE_DIGEST,
  structuredMarkerDetectorVersion: 'structured-marker-detectors-v1',
  structuredMarkerDetectorDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  languageCatalogueVersion: 'ai-review-language-catalogue-v1',
  languageCatalogueDigest: LANGUAGE_CATALOGUE_DIGEST,
})

export type AiOperationArtifactAttestations = Readonly<Record<string, unknown>>

export type AiOperationProfile = Readonly<{
  profileVersion: 'review-analysis-v3' | 'reply-suggestion-v2' | 'synthetic-canary-v1'
  command: 'analysis' | 'reply' | 'synthetic_canary'
  capability: MerchantAiCapability | null
  purpose: 'ai.analyze' | 'ai.generate_reply' | 'ai.synthetic_canary'
  sourceRoute: 'review-analysis' | 'reply-suggestion' | 'synthetic-canary'
  gatewayPath:
    '/v1/review-analysis' | '/v1/reply-suggestion' | 'internal:synthetic-canary'
  callerRole: 'web' | 'worker' | 'release_canary'
  capabilityRuntimeProfileVersion: string | null
  providerDeploymentProfileVersion: 'private-beta-global-v2' | 'private-beta-global-v3'
  outputSchemaName: string
  outputSchema: Readonly<Record<string, unknown>>
  outputSchemaDigest: string
  developerPrompt: string
  promptDigest: string
  artifactAttestations: AiOperationArtifactAttestations
  artifactAttestationsDigest: string
  sdkRequestShapeDigest: string
  staticTokenBearingBytes: number
  staticTokenBearingDigest: string
  sourceByteLimit: number
  providerPayloadByteLimit: number
  preparedRequestByteLimit: number
  responseByteLimit: number
  maxOutputTokens: number
  reasoningEffort: AiReasoningEffortV1
  providerDeadlineMs: number
  requestDeadlineMs: number
  executionLeaseMs: number
  profileDigest: string
}>

export type OperationProfileSource = Omit<
  AiOperationProfile,
  | 'outputSchemaDigest'
  | 'promptDigest'
  | 'artifactAttestationsDigest'
  | 'sdkRequestShapeDigest'
  | 'staticTokenBearingBytes'
  | 'staticTokenBearingDigest'
  | 'profileDigest'
>

function defineOperationProfile(source: OperationProfileSource): AiOperationProfile {
  const outputSchema = JSON.parse(canonicalizeRfc8785(source.outputSchema)) as Readonly<
    Record<string, unknown>
  >
  const outputSchemaDigest = digestOf('repkey-ai-output-schema-v1\0', outputSchema)
  const promptDigest = digestOf('repkey-ai-developer-prompt-v1\0', source.developerPrompt)
  const artifactAttestationsDigest = digestOf(
    'repkey-ai-operation-artifacts-v1\0',
    source.artifactAttestations,
  )
  const staticTokenBearing = renderOpenAiStaticTokenBearingMaterial({
    developerMessage: source.developerPrompt,
    format: Object.freeze({
      type: 'json_schema',
      name: source.outputSchemaName,
      strict: true,
      schema: outputSchema,
    }),
  })
  const staticTokenBearingBytes = staticTokenBearing.byteLength
  const staticTokenBearingDigest = staticTokenBearing.digest
  const sdkRequestShapeDigest = (
    source.artifactAttestations.sdk as typeof SDK_ATTESTATION
  ).requestShapeDigest
  const {
    outputSchema: _outputSchema,
    developerPrompt: _developerPrompt,
    ...persisted
  } = source
  const profileDigest = digestOf('repkey-ai-operation-profile-v1\0', {
    ...persisted,
    outputSchemaDigest,
    promptDigest,
    artifactAttestationsDigest,
    sdkRequestShapeDigest,
    staticTokenBearingBytes,
    staticTokenBearingDigest,
  })
  return Object.freeze({
    ...source,
    outputSchema,
    outputSchemaDigest,
    promptDigest,
    artifactAttestationsDigest,
    sdkRequestShapeDigest,
    staticTokenBearingBytes,
    staticTokenBearingDigest,
    profileDigest,
  })
}

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
  command: 'analysis' | 'reply' | 'synthetic_canary'
  capability: MerchantAiCapability | null
  purpose: 'ai.analyze' | 'ai.generate_reply' | 'ai.synthetic_canary'
  sourceRoute: 'review-analysis' | 'reply-suggestion' | 'synthetic-canary'
  gatewayPath:
    '/v1/review-analysis' | '/v1/reply-suggestion' | 'internal:synthetic-canary'
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

export function defineLogicalOperationProfile(
  source: LogicalOperationProfileSource,
): LogicalOperationProfile {
  const outputSchema = JSON.parse(canonicalizeRfc8785(source.outputSchema)) as Readonly<
    Record<string, unknown>
  >
  // The same domains as the catalogue entry, so the schema and prompt digests of a
  // profile do not change between the two.
  const outputSchemaDigest = digestOf('repkey-ai-output-schema-v1\0', outputSchema)
  const promptDigest = digestOf('repkey-ai-developer-prompt-v1\0', source.developerPrompt)
  const logicalArtifacts = JSON.parse(
    canonicalizeRfc8785(source.logicalArtifacts),
  ) as Readonly<Record<string, unknown>>
  const logicalArtifactsDigest = digestOf(
    'repkey-ai-logical-artifacts-v1\0',
    logicalArtifacts,
  )
  const {
    outputSchema: _outputSchema,
    developerPrompt: _developerPrompt,
    logicalArtifacts: _logicalArtifacts,
    ...persisted
  } = source
  const logicalDigest = digestOf('repkey-ai-logical-operation-profile-v1\0', {
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

/**
 * The catalogue entry for a logical profile served by OpenAI: the logical fields,
 * the SDK attestation, and the static token material the pairing reserves. The
 * reservation figures are recomputed by the entry's own builder and must agree with
 * the pairing, so a pairing that was made for another prompt or schema is refused
 * rather than priced wrongly.
 */
export function operationProfileForCatalogue(
  logical: LogicalOperationProfile,
  pairing: AiOperationProviderPairing,
): AiOperationProfile {
  if (
    pairing.providerId !== 'openai' ||
    pairing.logicalDigest !== logical.logicalDigest ||
    pairing.attestationDigest !== openAiAttestationOf(logical).digest
  ) {
    throw new TypeError('the pairing is not this profile served by OpenAI')
  }
  const profile = defineOperationProfile({
    profileVersion: logical.profileVersion as AiOperationProfile['profileVersion'],
    command: logical.command,
    capability: logical.capability,
    purpose: logical.purpose,
    sourceRoute: logical.sourceRoute,
    gatewayPath: logical.gatewayPath,
    callerRole: logical.callerRole,
    capabilityRuntimeProfileVersion: logical.capabilityRuntimeProfileVersion,
    providerDeploymentProfileVersion:
      logical.providerDeploymentProfileVersion as AiOperationProfile['providerDeploymentProfileVersion'],
    outputSchemaName: logical.outputSchemaName,
    outputSchema: logical.outputSchema,
    developerPrompt: logical.developerPrompt,
    artifactAttestations: Object.freeze({
      ...logical.logicalArtifacts,
      sdk:
        logical.profileVersion === 'reply-suggestion-v2'
          ? REPLY_STREAM_SDK_ATTESTATION
          : SDK_ATTESTATION,
    }),
    ...logical.limits,
  })
  if (
    profile.staticTokenBearingBytes !== pairing.staticTokenBearing.bytes ||
    profile.staticTokenBearingDigest !== pairing.staticTokenBearing.digest
  ) {
    throw new TypeError('the pairing reserves tokens this profile does not send')
  }
  return profile
}
