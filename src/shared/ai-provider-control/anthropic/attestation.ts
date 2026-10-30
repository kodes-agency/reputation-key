import {
  digestProviderAttestationValue,
  defineOperationProviderPairing,
  defineProviderAttestation,
  providerDeploymentAttestationFacts,
  type AiOperationProviderPairing,
} from '#/shared/ai-provider-attestations'
import { renderAnthropicStaticTokenBearingMaterial } from './request-builder'
import {
  ANTHROPIC_MODEL_SNAPSHOT,
  ANTHROPIC_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1,
  ANTHROPIC_PRICE_CATALOGUE_V1,
  ANTHROPIC_PROVIDER_DEPLOYMENT_CONTRACT_V1,
  ANTHROPIC_REQUEST_SHAPE_V1_DIGEST,
  ANTHROPIC_STRUCTURED_OUTPUT_OVERHEAD_TOKENS,
} from './request-profile'
import {
  ANTHROPIC_SCHEMA_TRANSFORM_VERSION,
  anthropicWireSchemaOf,
} from './schema-transform'

// The three labels below name code rather than a document:
//   - 'anthropic-restricted-lookup-v1'      createRestrictedAnthropicLookup
//   - 'anthropic-pinned-sdk-headers-v1'     expectedPinnedAnthropicSdkHeaders
//   - 'anthropic-messages-usage-v1'         parseAnthropicUsage

const CONTRACT = ANTHROPIC_PROVIDER_DEPLOYMENT_CONTRACT_V1

export const ANTHROPIC_PROVIDER_ATTESTATION_V1 = defineProviderAttestation(
  providerDeploymentAttestationFacts({
    providerId: 'anthropic',
    requestProfileVersion: 'anthropic-messages-request-profile-v1',
    model: ANTHROPIC_MODEL_SNAPSHOT,
    adapterName: 'anthropic-messages-adapter',
    sdkName: '@anthropic-ai/sdk',
    sdkVersion: CONTRACT.sdkVersion,
    requestShapeVersion: 'anthropic-messages-request-shape-v1',
    requestShapeDigest: ANTHROPIC_REQUEST_SHAPE_V1_DIGEST,
    dnsPolicy: 'anthropic-restricted-lookup-v1',
    headerProfile: 'anthropic-pinned-sdk-headers-v1',
    usageProfile: 'anthropic-messages-usage-v1',
    claimsDigest: ANTHROPIC_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1,
    pricing: ANTHROPIC_PRICE_CATALOGUE_V1,
    deployment: CONTRACT,
  }),
)

export function anthropicPairingOf(
  profile: Readonly<{
    logicalDigest: string
    developerPrompt: string
    outputSchema: Readonly<Record<string, unknown>>
  }>,
): AiOperationProviderPairing {
  const wireSchema = anthropicWireSchemaOf(profile.outputSchema)
  const staticMaterial = renderAnthropicStaticTokenBearingMaterial({
    developerPrompt: profile.developerPrompt,
    wireSchema,
  })
  return defineOperationProviderPairing({
    providerId: 'anthropic',
    logicalDigest: profile.logicalDigest,
    attestationDigest: ANTHROPIC_PROVIDER_ATTESTATION_V1.digest,
    schemaTransform: {
      version: ANTHROPIC_SCHEMA_TRANSFORM_VERSION,
      digest: digestProviderAttestationValue(
        'repkey-anthropic-wire-schema-v1\0',
        wireSchema,
      ),
    },
    staticTokenBearing: {
      bytes: staticMaterial.byteLength + ANTHROPIC_STRUCTURED_OUTPUT_OVERHEAD_TOKENS,
      digest: staticMaterial.digest,
    },
  })
}
