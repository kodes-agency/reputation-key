import { createHash } from 'node:crypto'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import { OPENAI_MODEL_SNAPSHOT } from './ai-openai-request-contract'
import { OPENAI_PROVIDER_DEPLOYMENT_CONTRACT_V1 } from './ai-openai-provider-profile'
import { OPENAI_PROVIDER_ATTESTATION_V1 } from './ai-openai-provider-attestation'
import { ANTHROPIC_PROVIDER_ATTESTATION_V1 } from './ai-provider-control/anthropic/attestation'
import { defineProviderDeploymentEnvelope } from './ai-provider-attestations'

// The provider deployment profile this build serves: `private-beta-global-v2`
// (contract sections 2.1 and 7.1), in force since the switch-on of review analysis v3
// (2026-10-30). A consent is recorded under it, so a change to it is a change the
// owner confirms again, and `private-beta-global-v1` (OpenAI `gpt-5.6-luna` alone)
// lapses with the notice it was recorded under.
//
// What it is: the envelope of every provider a deployment may call, each named by
// the digest of its attestation (model, SDK, request shape, endpoint, headers, usage,
// price list, posture), and the OpenAI deployment contract that serves every
// capability that runs today. Choosing a provider inside the envelope is NOT a
// change to it (contract section 7.1): the operator's choice
// (`operator-provider-selection.ts`) is the only input that moves between providers,
// so the later move to Anthropic needs no new profile and no new consent, as the
// merchant notice says. Adding, removing or re-attesting a provider is a change, and
// so is the model.
//
// Anthropic is named here and is not selectable: `OPERATOR_PROVIDER_SELECTION` names
// OpenAI alone, the egress runtime registers no Anthropic adapter and the
// deployment has no Anthropic key.

const AI_PROVIDER_DEPLOYMENT_ENVELOPE_V2 = defineProviderDeploymentEnvelope({
  profileVersion: 'private-beta-global-v2',
  region: 'global',
  attestations: [OPENAI_PROVIDER_ATTESTATION_V1, ANTHROPIC_PROVIDER_ATTESTATION_V1],
})

const AI_PROVIDER_DEPLOYMENT_PROFILE_FIELDS_V2 = Object.freeze({
  profileVersion: 'private-beta-global-v2',
  region: 'global',
  // Every provider the deployment may call, by attestation digest.
  providers: AI_PROVIDER_DEPLOYMENT_ENVELOPE_V2.providers,
  // The provider every capability runs on today, and how it is called.
  provider: 'openai',
  modelSnapshot: OPENAI_MODEL_SNAPSHOT,
  reasoningEffort: 'route-profile-effort',
  serviceTier: 'default',
  store: false,
  responseApiVersion: 'responses-v1',
  deploymentContract: OPENAI_PROVIDER_DEPLOYMENT_CONTRACT_V1,
})

export const AI_PROVIDER_DEPLOYMENT_PROFILE_V2 = Object.freeze({
  ...AI_PROVIDER_DEPLOYMENT_PROFILE_FIELDS_V2,
  profileDigest: createHash('sha256')
    .update('repkey-ai-provider-deployment-profile-v2\0', 'utf8')
    .update(canonicalizeRfc8785(AI_PROVIDER_DEPLOYMENT_PROFILE_FIELDS_V2), 'utf8')
    .digest('hex'),
})
