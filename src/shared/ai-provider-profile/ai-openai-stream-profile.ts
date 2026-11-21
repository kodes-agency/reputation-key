import {
  OPENAI_REQUEST_SHAPE_V1,
  OPENAI_PROVIDER_DEPLOYMENT_CONTRACT_V1,
  OPENAI_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1,
  OPENAI_PRICE_CATALOGUE_V2,
} from './ai-openai-provider-profile'
import { OPENAI_MODEL_SNAPSHOT } from './ai-openai-request-contract'
import {
  defineProviderAttestation,
  defineProviderDeploymentEnvelope,
  digestProviderAttestationValue,
  providerDeploymentAttestationFacts,
} from './ai-provider-attestations'

export const REPLY_STREAM_RESPONSE_MAX_BYTES = 1_048_576

/** Compatible technical refresh, registered only for the dark reply v2 route. */
const OPENAI_REPLY_STREAM_SHAPE = Object.freeze({
  ...OPENAI_REQUEST_SHAPE_V1,
  stream: true,
})
export const OPENAI_REPLY_STREAM_SHAPE_DIGEST = digestProviderAttestationValue(
  'repkey-openai-reply-stream-shape-v1\0',
  OPENAI_REPLY_STREAM_SHAPE,
)
const OPENAI_REPLY_STREAM_CONTRACT = Object.freeze({
  ...OPENAI_PROVIDER_DEPLOYMENT_CONTRACT_V1,
  stream: true,
  successMediaTypeProfile: 'text-event-stream-utf8-bounded-v1',
  requestShapeDigest: OPENAI_REPLY_STREAM_SHAPE_DIGEST,
})
export const OPENAI_REPLY_STREAM_ATTESTATION = defineProviderAttestation(
  providerDeploymentAttestationFacts({
    providerId: 'openai',
    requestProfileVersion: 'openai-reply-stream-request-profile-v1',
    model: OPENAI_MODEL_SNAPSHOT,
    adapterName: 'openai-responses-adapter',
    sdkName: 'openai',
    sdkVersion: OPENAI_REPLY_STREAM_CONTRACT.sdkVersion,
    requestShapeVersion: 'openai-reply-stream-request-shape-v1',
    requestShapeDigest: OPENAI_REPLY_STREAM_SHAPE_DIGEST,
    dnsPolicy: 'openai-restricted-lookup-v1',
    headerProfile: 'openai-pinned-sdk-headers-v1',
    usageProfile: 'openai-responses-usage-v1',
    claimsDigest: OPENAI_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1,
    pricing: OPENAI_PRICE_CATALOGUE_V2,
    deployment: OPENAI_REPLY_STREAM_CONTRACT,
  }),
)
export const REPLY_STREAM_DEPLOYMENT = defineProviderDeploymentEnvelope({
  profileVersion: 'private-beta-global-v3',
  region: 'global',
  attestations: [OPENAI_REPLY_STREAM_ATTESTATION],
})
export const REPLY_STREAM_SDK_ATTESTATION = Object.freeze({
  requestShapeVersion: 'openai-reply-stream-request-shape-v1',
  requestShapeDigest: OPENAI_REPLY_STREAM_SHAPE_DIGEST,
  providerTransportProfile: 'openai-reply-stream-transport-v1',
  providerAttestationDigest: OPENAI_REPLY_STREAM_ATTESTATION.digest,
})
