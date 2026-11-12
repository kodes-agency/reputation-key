import { AI_ROUTE_OUTPUT_JSON_SCHEMAS } from '#/shared/ai-route-output-schemas'
import { AI_PROVIDER_DEPLOYMENT_PROFILE_V2 } from '#/shared/ai-provider-deployment-profile'
import { openAiPairingOf } from '#/shared/ai-openai-provider-attestation'
import { digestOf } from '#/shared/ai-digest'
import {
  defineLogicalOperationProfile,
  operationProfileForCatalogue,
  type AiOperationProfile,
} from '#/shared/ai-operation-profile'
import {
  REVIEW_ANALYSIS_V3_LOGICAL_PROFILE,
  REVIEW_ANALYSIS_V3_OPENAI_PAIRING,
} from '#/shared/analysis/profile'
import { REPLY_DRAFTING_V2_OPERATION_PROFILE } from '#/shared/reply/profile'

export { OPENAI_REQUEST_SHAPE_V1_DIGEST } from '#/shared/ai-openai-provider-profile'
// What a catalogue consumer imports from here is re-exported so this stays its one place.
export { AI_SOURCE_CANONICALIZER_PROFILE_V1 } from '#/shared/ai-operation-profile'
export type {
  AiOperationArtifactAttestations,
  AiOperationProfile,
  OperationProfileSource,
} from '#/shared/ai-operation-profile'

export const AI_PROVIDER_DEPLOYMENT_PROFILE = AI_PROVIDER_DEPLOYMENT_PROFILE_V2

const ROUTING_POLICY_FIELDS = Object.freeze({
  version: 1,
  region: 'global',
  providerDeploymentProfileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
})

export const AI_ROUTING_POLICY = Object.freeze({
  ...ROUTING_POLICY_FIELDS,
  policyDigest: digestOf('repkey-ai-routing-policy-v1\0', ROUTING_POLICY_FIELDS),
})

export const SYNTHETIC_CANARY_LOGICAL_PROFILE = defineLogicalOperationProfile({
  profileVersion: 'synthetic-canary-v1',
  command: 'synthetic_canary',
  capability: null,
  purpose: 'ai.synthetic_canary',
  sourceRoute: 'synthetic-canary',
  gatewayPath: 'internal:synthetic-canary',
  callerRole: 'release_canary',
  capabilityRuntimeProfileVersion: null,
  providerDeploymentProfileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
  outputSchemaName: 'synthetic_canary_v1',
  outputSchema: AI_ROUTE_OUTPUT_JSON_SCHEMAS['synthetic-canary'],
  developerPrompt: 'Return the exact synthetic canary marker. Do not add text.',
  logicalArtifacts: Object.freeze({
    canaryProfileVersion: 'synthetic-canary-v1',
    safetyIdentifierProfileVersion: 'synthetic-canary-safety-v1',
    promptCacheShard: 0,
  }),
  limits: {
    sourceByteLimit: 16_384,
    providerPayloadByteLimit: 16_384,
    preparedRequestByteLimit: 65_536,
    responseByteLimit: 131_072,
    // Reasoning tokens count toward output_tokens, so a 64-token ceiling could not
    // fit an answer and the release gate failed with `output_invalid`. The ceiling
    // was raised to absorb that; at 'low' the marker costs 39 tokens.
    //
    // The canary carries the SAME effort as the tenant routes deliberately. Its task
    // is trivial enough to survive any setting, which is exactly how it stayed green
    // while every real route truncated: a gate that does not share production's
    // provider configuration cannot detect a provider-configuration fault.
    maxOutputTokens: 512,
    reasoningEffort: 'low',
    providerDeadlineMs: 60_000,
    requestDeadlineMs: 70_000,
    executionLeaseMs: 120_000,
  },
})

export const SYNTHETIC_CANARY_OPENAI_PAIRING = openAiPairingOf(
  SYNTHETIC_CANARY_LOGICAL_PROFILE,
)

// The operation profiles a build serves: review analysis v3 and reply drafting v2
// (each named by its capability in `ai-runtime-capability-contract.ts`) and the
// release canary. Operations recorded under the retired review analysis v2 and
// reply v1 profiles stay readable by their recorded version strings alone: no
// catalogue entry describes them, so nothing new is claimed or priced under them.
export const AI_OPERATION_PROFILES: ReadonlyArray<AiOperationProfile> = Object.freeze([
  operationProfileForCatalogue(
    REVIEW_ANALYSIS_V3_LOGICAL_PROFILE,
    REVIEW_ANALYSIS_V3_OPENAI_PAIRING,
  ),
  REPLY_DRAFTING_V2_OPERATION_PROFILE,
  operationProfileForCatalogue(
    SYNTHETIC_CANARY_LOGICAL_PROFILE,
    SYNTHETIC_CANARY_OPENAI_PAIRING,
  ),
])
