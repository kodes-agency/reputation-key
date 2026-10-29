import '@tanstack/react-start/server-only'
import { defineLogicalOperationProfile } from './ai-logical-operation-profile'
import { openAiPairingOf } from './ai-openai-provider-attestation'
import {
  PROPERTY_CALENDAR_ATTESTATION,
  REVIEW_SOURCE_ATTESTATION,
} from './ai-operation-profiles'
import { AI_ROUTE_OUTPUT_JSON_SCHEMAS } from './ai-route-output-schemas'
import { MAX_AI_REVIEW_SENTENCES_V1 } from './ai-review-source-contract'
import { REVIEW_ANALYSIS_V3_VERSIONS } from './review-analysis-v3'
import { REVIEW_ANALYSIS_V3_LOGICAL_ARTIFACTS } from './review-analysis-v3-artifacts'
import { REVIEW_ANALYSIS_V3_DEVELOPER_PROMPT } from './review-analysis-v3-prompt'
import { AI_REVIEW_V3_ROUTE_MAX_BYTES } from './review-analysis-v3-request'

// The v3 operation profile, dark. It is NOT in `AI_OPERATION_PROFILES` and no
// runtime catalogue row, merchant notice or deployment profile names it:
// `review-analysis-v3.test.ts` fails if any does. Activation (slice 3.10) is what
// registers it. Until then this is the object the evaluation harness reads for the
// production prompt and schema, the Anthropic adapter reads to derive its pairing,
// and the activation slice puts in the catalogue.
//
// What the profile attests is the operation, in no provider's terms. Hints are not
// here on purpose: they are request context, so adding a kind of business reaches
// the next request and moves no digest (`review-vocabulary-hints.ts`).

export const REVIEW_ANALYSIS_V3_LOGICAL_PROFILE = defineLogicalOperationProfile({
  profileVersion: REVIEW_ANALYSIS_V3_VERSIONS.analysisOperation,
  command: 'analysis',
  capability: 'review_analysis',
  purpose: 'ai.analyze',
  sourceRoute: 'review-analysis',
  gatewayPath: '/v1/review-analysis',
  callerRole: 'worker',
  capabilityRuntimeProfileVersion: REVIEW_ANALYSIS_V3_VERSIONS.capabilityRuntime,
  providerDeploymentProfileVersion: REVIEW_ANALYSIS_V3_VERSIONS.providerDeployment,
  outputSchemaName: 'review_analysis_v3',
  outputSchema: AI_ROUTE_OUTPUT_JSON_SCHEMAS['review-analysis-v3'],
  developerPrompt: REVIEW_ANALYSIS_V3_DEVELOPER_PROMPT,
  logicalArtifacts: Object.freeze({
    source: REVIEW_SOURCE_ATTESTATION,
    calendar: PROPERTY_CALENDAR_ATTESTATION,
    ...REVIEW_ANALYSIS_V3_LOGICAL_ARTIFACTS,
    evidenceRequest: Object.freeze({
      payloadShape: 'review-analysis-v3-request-v1',
      propertyContextShape: 'review-property-context-v1',
      sentenceRedaction: 'joined-scan-projected-agreeing-with-whole-text-v1',
      maxSentences: MAX_AI_REVIEW_SENTENCES_V1,
      transportByteLimit: AI_REVIEW_V3_ROUTE_MAX_BYTES,
    }),
    resultShape: 'review-analysis-v3-normalized-result-v1',
  }),
  limits: {
    sourceByteLimit: 16_384,
    // The largest payload the Review limits allow, every character escaped: the
    // sentences, their wrappers and a full hint set. A ceiling, not a price: a
    // reservation is made from the bytes a request actually carries.
    providerPayloadByteLimit: 57_344,
    preparedRequestByteLimit: 131_072,
    responseByteLimit: 131_072,
    // Up to 48 mentions of about 60 tokens each, and a low reasoning effort. The
    // first value, to be measured against the gold set before activation.
    maxOutputTokens: 4_096,
    reasoningEffort: 'low',
    providerDeadlineMs: 60_000,
    requestDeadlineMs: 70_000,
    executionLeaseMs: 120_000,
  },
})

/** The v3 profile as OpenAI carries it: the pairing an OpenAI-served v3 operation would use. */
export const REVIEW_ANALYSIS_V3_OPENAI_PAIRING = openAiPairingOf(
  REVIEW_ANALYSIS_V3_LOGICAL_PROFILE,
)
