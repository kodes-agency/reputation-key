import { createHash } from 'node:crypto'
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
import { AI_SOURCE_CANONICALIZER_PROFILE_V1 } from '#/shared/ai-source-profile'

// The parts of an operation profile every profile is made of: what the profile
// attests about the Property calendar, the SDK request shape and the review source,
// the type of a profile, and the one function that seals a profile with its digests.
// They live apart from the catalogue (`ai-operation-profiles.ts`) so the dark v3
// profile (`review-analysis-v3-profile.ts`) and the views that turn a logical
// profile into a catalogue entry (`ai-operation-profile-views.ts`) can use them
// without importing the catalogue that now holds the v3 entry.

export { AI_SOURCE_CANONICALIZER_PROFILE_V1 }

function digest(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(domain, 'utf8')
    .update(canonicalizeRfc8785(value), 'utf8')
    .digest('hex')
}

export const PROPERTY_CALENDAR_ATTESTATION = Object.freeze({
  profileVersion: 'property-calendar-v1',
  epochMillisFunction: 'ai_epoch_millis_v1',
  localCalendarFunction: 'ai_property_local_date_v1',
  localMidnightFunction: 'ai_property_local_midnight_v1',
  databaseImageDigest: '33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20',
  testedPostgresMajorVersions: Object.freeze([16]),
})

export const SDK_ATTESTATION = Object.freeze({
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
  profileVersion:
    | 'review-analysis-v2'
    // Dark: no entry of `AI_OPERATION_PROFILES` has it. It is the name a catalogue
    // entry derived from the v3 logical profile will carry (`ai-operation-profile-views.ts`).
    | 'review-analysis-v3'
    | 'reply-suggestion-v1'
    | 'reply-suggestion-v2'
    | 'property-trend-v1'
    | 'synthetic-canary-v1'
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
  providerDeploymentProfileVersion:
    'private-beta-global-v1' | 'private-beta-global-v2' | 'private-beta-global-v3'
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

export function defineOperationProfile(
  source: OperationProfileSource,
): AiOperationProfile {
  const outputSchema = JSON.parse(canonicalizeRfc8785(source.outputSchema)) as Readonly<
    Record<string, unknown>
  >
  const outputSchemaDigest = digest('repkey-ai-output-schema-v1\0', outputSchema)
  const promptDigest = digest('repkey-ai-developer-prompt-v1\0', source.developerPrompt)
  const artifactAttestationsDigest = digest(
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
  const profileDigest = digest('repkey-ai-operation-profile-v1\0', {
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
