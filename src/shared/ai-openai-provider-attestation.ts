import { createHash } from 'node:crypto'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import {
  OPENAI_MODEL_SNAPSHOT,
  renderOpenAiStaticTokenBearingMaterial,
} from './ai-openai-request-contract'
import {
  OPENAI_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1,
  OPENAI_PRICE_CATALOGUE_V1,
  OPENAI_PROVIDER_DEPLOYMENT_CONTRACT_V1,
  OPENAI_REQUEST_SHAPE_V1_DIGEST,
} from './ai-openai-provider-profile'
import {
  defineOperationProviderPairing,
  defineProviderAttestation,
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

export const OPENAI_PROVIDER_ATTESTATION_V1 = defineProviderAttestation({
  providerId: 'openai',
  requestProfileVersion: 'openai-responses-request-profile-v1',
  model: OPENAI_MODEL_SNAPSHOT,
  adapter: { name: 'openai-responses-adapter', version: 'v1' },
  sdk: { name: 'openai', version: CONTRACT.sdkVersion },
  requestShape: {
    version: 'openai-responses-request-shape-v1',
    digest: OPENAI_REQUEST_SHAPE_V1_DIGEST,
  },
  transport: {
    endpoint: CONTRACT.endpoint,
    dnsPolicy: 'openai-restricted-lookup-v1',
    headerProfile: 'openai-pinned-sdk-headers-v1',
    dispatcher: CONTRACT.dispatcherVersion,
    redirectMode: CONTRACT.redirectMode,
    sdkMaxRetries: CONTRACT.sdkMaxRetries,
    maxHttpRequestsPerPermit: CONTRACT.maxHttpRequestsPerPermit,
    possibleDispatchBoundary: CONTRACT.possibleDispatchBoundary,
    successStatus: CONTRACT.successStatus,
    successMediaTypeProfile: CONTRACT.successMediaTypeProfile,
    clientRequestIdProfile: CONTRACT.clientRequestIdProfile,
  },
  usage: { profile: 'openai-responses-usage-v1' },
  dispositions: {
    profile: CONTRACT.statusDispositionProfile,
    retryableCompleteStatuses: [...CONTRACT.retryableCompleteStatuses],
    retryAfterProfile: CONTRACT.retryAfterProfile,
  },
  pricing: OPENAI_PRICE_CATALOGUE_V1,
  rateLimit: {
    admission: 'ai-lane-admission-adr-0058',
    retryAfterProfile: CONTRACT.retryAfterProfile,
  },
  posture: {
    claimsDigest: OPENAI_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1,
    retrievalDate: CONTRACT.evidence.retrievalDate,
  },
})

function digestOf(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(domain, 'utf8')
    .update(canonicalizeRfc8785(value), 'utf8')
    .digest('hex')
}

/**
 * What the Responses API is sent of a logical profile before any payload byte:
 * its developer message and its structured-output format. The schema goes as the
 * profile states it, because the closed form the profile's schema is derived in is
 * already the one OpenAI's strict mode takes, so the transform is the identity
 * and its digest is the schema's own, domain-separated.
 */
export function openAiPairingOf(
  profile: Readonly<{
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
    attestationDigest: OPENAI_PROVIDER_ATTESTATION_V1.digest,
    schemaTransform: {
      version: 'openai-strict-json-schema-identity-v1',
      digest: digestOf('repkey-openai-wire-schema-v1\0', profile.outputSchema),
    },
    staticTokenBearing: {
      bytes: staticMaterial.byteLength,
      digest: staticMaterial.digest,
    },
  })
}
