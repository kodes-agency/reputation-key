import { OPENAI_REPLY_STREAM_ATTESTATION } from './ai-openai-stream-profile'
import {
  OPENAI_MODEL_SNAPSHOT,
  renderOpenAiStaticTokenBearingMaterial,
} from './ai-openai-request-contract'
import {
  OPENAI_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1,
  OPENAI_PRICE_CATALOGUE_V2,
  OPENAI_PROVIDER_DEPLOYMENT_CONTRACT_V1,
  OPENAI_REQUEST_SHAPE_V1_DIGEST,
} from './ai-openai-provider-profile'
import {
  digestProviderAttestationValue,
  defineOperationProviderPairing,
  defineProviderAttestation,
  providerDeploymentAttestationFacts,
  type AiOperationProviderPairing,
} from './ai-provider-attestations'

// OpenAI's attestation is a restatement, not a new claim: every fact below is one
// the deployment contract (`OPENAI_PROVIDER_DEPLOYMENT_CONTRACT_V1`), the request
// shape and the price catalogue already pin, gathered under the headings every
// provider is attested under. The three labels that name code rather than a
// document are anchored here:
//   - 'openai-restricted-lookup-v1'   createRestrictedOpenAiLookup: only
//     api.openai.com resolves, and an address in a forbidden range refuses the call.
//   - 'openai-pinned-sdk-headers-v1'  expectedPinnedSdkHeaders: the SDK's exact
//     header set, checked before a byte leaves, and the outbound set the one-shot
//     fetch sends.
//   - 'openai-responses-usage-v1'     parseUsage: shape, cached <= input,
//     reasoning <= output, total = input + output, and the input ceiling.

const CONTRACT = OPENAI_PROVIDER_DEPLOYMENT_CONTRACT_V1

export const OPENAI_PROVIDER_ATTESTATION_V1 = defineProviderAttestation(
  providerDeploymentAttestationFacts({
    providerId: 'openai',
    requestProfileVersion: 'openai-responses-request-profile-v1',
    model: OPENAI_MODEL_SNAPSHOT,
    adapterName: 'openai-responses-adapter',
    sdkName: 'openai',
    sdkVersion: CONTRACT.sdkVersion,
    requestShapeVersion: 'openai-responses-request-shape-v1',
    requestShapeDigest: OPENAI_REQUEST_SHAPE_V1_DIGEST,
    dnsPolicy: 'openai-restricted-lookup-v1',
    headerProfile: 'openai-pinned-sdk-headers-v1',
    usageProfile: 'openai-responses-usage-v1',
    claimsDigest: OPENAI_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1,
    pricing: OPENAI_PRICE_CATALOGUE_V2,
    deployment: CONTRACT,
  }),
)

/**
 * What the Responses API is sent of a logical profile before any payload byte:
 * its developer message and its structured-output format. The schema goes as the
 * profile states it, because the closed form the profile's schema is derived in is
 * already the one OpenAI's strict mode takes, so the transform is the identity
 * and its digest is the schema's own, domain-separated.
 */
export function openAiPairingOf(
  profile: Readonly<{
    profileVersion?: string
    logicalDigest: string
    developerPrompt: string
    outputSchemaName: string
    outputSchema: Readonly<Record<string, unknown>>
  }>,
): AiOperationProviderPairing {
  const staticMaterial = renderOpenAiStaticTokenBearingMaterial({
    developerMessage: profile.developerPrompt,
    format: Object.freeze({
      type: 'json_schema',
      name: profile.outputSchemaName,
      strict: true,
      schema: profile.outputSchema,
    }),
  })
  return defineOperationProviderPairing({
    providerId: 'openai',
    logicalDigest: profile.logicalDigest,
    attestationDigest: openAiAttestationOf(profile).digest,
    schemaTransform: {
      version: 'openai-strict-json-schema-identity-v1',
      digest: digestProviderAttestationValue(
        'repkey-openai-wire-schema-v1\0',
        profile.outputSchema,
      ),
    },
    staticTokenBearing: {
      bytes: staticMaterial.byteLength,
      digest: staticMaterial.digest,
    },
  })
}

export function openAiAttestationOf(profile: Readonly<{ profileVersion?: string }>) {
  return profile.profileVersion === 'reply-suggestion-v2'
    ? OPENAI_REPLY_STREAM_ATTESTATION
    : OPENAI_PROVIDER_ATTESTATION_V1
}
