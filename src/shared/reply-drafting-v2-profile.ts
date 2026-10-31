import {
  REPLY_STREAM_SDK_ATTESTATION,
  REPLY_STREAM_RESPONSE_MAX_BYTES,
} from './ai-openai-stream-profile'
import { REPLY_DRAFTING_V2_APOLOGIES } from './domain/reply-drafting-v2'
import {
  defineOperationProfile,
  REVIEW_SOURCE_ATTESTATION,
  PROPERTY_CALENDAR_ATTESTATION,
} from './ai-operation-profile-core'
import { AI_ROUTE_OUTPUT_JSON_SCHEMAS } from './ai-route-output-schemas'
import { REPLY_DRAFTING_V2_PROMPT } from './reply-drafting-v2-prompt'
import { REPLY_DRAFTING_V2_VERSIONS } from './reply-drafting-v2-schema'
import { REPLY_DRAFTING_V2_PROFILE_DIGEST } from './reply-drafting-v2-contract'
import {
  REPLY_DRAFTING_V2_DYNAMIC_PROMPT_BYTES,
  REPLY_DRAFTING_V2_EXAMPLES_DIGEST,
  REPLY_DRAFTING_V2_ROUTE_MAX_BYTES,
} from './reply-drafting-v2-request'
import { REPLY_BODY_LINT_DIGEST, REPLY_BODY_LINT_VERSION } from './reply-drafting-v2-lint'
import { AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST } from './ai-reply-language-verifier'
import { AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST } from './ai-language-script-consistency'

/** Served for reply drafting after the drafting-only notice renewal (PR-B3b). */
export const REPLY_DRAFTING_V2_OPERATION_PROFILE = defineOperationProfile({
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
  artifactAttestations: {
    source: REVIEW_SOURCE_ATTESTATION,
    calendar: PROPERTY_CALENDAR_ATTESTATION,
    sdk: REPLY_STREAM_SDK_ATTESTATION,
    replyProfile: REPLY_DRAFTING_V2_VERSIONS.profile,
    replyProfileDigest: REPLY_DRAFTING_V2_PROFILE_DIGEST,
    promptVersion: REPLY_DRAFTING_V2_VERSIONS.prompt,
    options: {
      apologyStarts: REPLY_DRAFTING_V2_APOLOGIES,
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
  sourceByteLimit: 16_384,
  providerPayloadByteLimit: 57_344,
  preparedRequestByteLimit: REPLY_DRAFTING_V2_ROUTE_MAX_BYTES,
  responseByteLimit: REPLY_STREAM_RESPONSE_MAX_BYTES,
  maxOutputTokens: 2_048,
  reasoningEffort: 'medium',
  providerDeadlineMs: 60_000,
  requestDeadlineMs: 70_000,
  executionLeaseMs: 120_000,
})
