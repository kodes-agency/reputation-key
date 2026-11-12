import { REPLY_STREAM_RESPONSE_MAX_BYTES } from '#/shared/ai-openai-stream-profile'
import { REPLY_DRAFTING_V2_APOLOGY_STARTS } from '#/shared/domain/reply-drafting-v2'
import {
  defineLogicalOperationProfile,
  operationProfileForCatalogue,
  REVIEW_SOURCE_ATTESTATION,
  PROPERTY_CALENDAR_ATTESTATION,
} from '#/shared/ai-operation-profile'
import { openAiPairingOf } from '#/shared/ai-openai-provider-attestation'
import { AI_ROUTE_OUTPUT_JSON_SCHEMAS } from '#/shared/ai-route-output-schemas'
import { REPLY_DRAFTING_V2_PROMPT } from '#/shared/reply-drafting-v2-prompt'
import { REPLY_DRAFTING_V2_VERSIONS } from '#/shared/reply-drafting-v2-schema'
import { REPLY_DRAFTING_V2_PROFILE_DIGEST } from '#/shared/reply-drafting-v2-contract'
import {
  REPLY_DRAFTING_V2_DYNAMIC_PROMPT_BYTES,
  REPLY_DRAFTING_V2_EXAMPLES_DIGEST,
  REPLY_DRAFTING_V2_ROUTE_MAX_BYTES,
} from '#/shared/reply-drafting-v2-request'
import {
  REPLY_BODY_LINT_DIGEST,
  REPLY_BODY_LINT_VERSION,
} from '#/shared/reply-drafting-v2-lint'
import { AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST } from '#/shared/ai-reply-language-verifier'
import { AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST } from '#/shared/ai-language-script-consistency'

/** Reply drafting in no provider's terms; the runtime catalogue serves it for reply drafting. */
export const REPLY_DRAFTING_V2_LOGICAL_PROFILE = defineLogicalOperationProfile({
  profileVersion: REPLY_DRAFTING_V2_VERSIONS.operation,
  command: 'reply',
  capability: 'reply_drafting',
  purpose: 'ai.generate_reply',
  sourceRoute: 'reply-suggestion',
  gatewayPath: '/v1/reply-suggestion',
  callerRole: 'web',
  capabilityRuntimeProfileVersion: REPLY_DRAFTING_V2_VERSIONS.runtime,
  providerDeploymentProfileVersion: 'private-beta-global-v3',
  outputSchemaName: 'reply_draft_v4',
  outputSchema: AI_ROUTE_OUTPUT_JSON_SCHEMAS['reply-suggestion-v2'],
  developerPrompt: REPLY_DRAFTING_V2_PROMPT,
  logicalArtifacts: {
    source: REVIEW_SOURCE_ATTESTATION,
    calendar: PROPERTY_CALENDAR_ATTESTATION,
    replyProfile: REPLY_DRAFTING_V2_VERSIONS.profile,
    replyProfileDigest: REPLY_DRAFTING_V2_PROFILE_DIGEST,
    promptVersion: REPLY_DRAFTING_V2_VERSIONS.prompt,
    options: {
      apologyStarts: REPLY_DRAFTING_V2_APOLOGY_STARTS,
      opening: [1, 3],
      maxWords: [8, 80],
      maxWordsRequiresShort: true,
    },
    exampleBookVersion: 'reply-synthetic-examples-v1',
    exampleBookDigest: REPLY_DRAFTING_V2_EXAMPLES_DIGEST,
    lintVersion: REPLY_BODY_LINT_VERSION,
    lintDigest: REPLY_BODY_LINT_DIGEST,
    languageVerifier: AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST,
    scriptVerifier: AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST,
    dynamicDeveloperBytes: REPLY_DRAFTING_V2_DYNAMIC_PROMPT_BYTES,
    sentenceRedaction: 'joined-scan-projected-agreeing-with-whole-text-v1',
  },
  limits: {
    sourceByteLimit: 16_384,
    providerPayloadByteLimit: 57_344,
    preparedRequestByteLimit: REPLY_DRAFTING_V2_ROUTE_MAX_BYTES,
    responseByteLimit: REPLY_STREAM_RESPONSE_MAX_BYTES,
    // Medium effort spends most of this on reasoning, and more on a long review: on the
    // realistic test set Bulgarian reached 1,609 at the 90th percentile and one draft used
    // all of 2,048, which returned no reply at all. Only what is used is charged.
    maxOutputTokens: 4_096,
    reasoningEffort: 'medium',
    providerDeadlineMs: 60_000,
    requestDeadlineMs: 70_000,
    executionLeaseMs: 120_000,
  },
})

/** Reply drafting as OpenAI carries it, and the catalogue entry that pairing gives. */
export const REPLY_DRAFTING_V2_OPENAI_PAIRING = openAiPairingOf(
  REPLY_DRAFTING_V2_LOGICAL_PROFILE,
)

export const REPLY_DRAFTING_V2_OPERATION_PROFILE = operationProfileForCatalogue(
  REPLY_DRAFTING_V2_LOGICAL_PROFILE,
  REPLY_DRAFTING_V2_OPENAI_PAIRING,
)
