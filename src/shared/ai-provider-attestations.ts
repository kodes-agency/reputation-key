import { createHash } from 'node:crypto'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import type { AiProviderId } from './ai-provider-ids'
import type { AiProviderPriceCatalogue } from './ai-provider-pricing'

// What a provider is attested to be (contract section 7.1). An operation profile
// says what is asked, in no provider's terms (`ai-logical-operation-profile.ts`).
// An attestation says how one provider is asked, what it answers with, what it
// charges and what it promises about the data, and each fact in it is one a
// reviewer can compare with the code that acts on it. The two meet in a pairing:
// the reservation material and the wire schema that one provider derives from one
// logical profile. Changing a provider's SDK, request transform, headers, model or
// price list moves that provider's attestation and no logical digest; changing the
// prompt, schema or normalizer moves a logical digest and no attestation.

export const AI_PROVIDER_ATTESTATION_VERSION = 'ai-provider-attestation-v1' as const

type Versioned = Readonly<{ version: string }>
type Pinned = Readonly<{ version: string; digest: string }>

export type AiProviderAttestationFacts = Readonly<{
  providerId: AiProviderId
  /** Names what this attestation's request profile is called on an operation row. */
  requestProfileVersion: string
  /** The exact snapshot a request names. A floating alias needs its reason recorded. */
  model: string
  adapter: Readonly<{ name: string }> & Versioned
  sdk: Readonly<{ name: string }> & Versioned
  /** The request body's shape: every field and which of them vary. */
  requestShape: Pinned
  /** Where it goes and how: the endpoint, name resolution, headers, redirects, retries. */
  transport: Readonly<{
    endpoint: string
    dnsPolicy: string
    headerProfile: string
    dispatcher: string
    redirectMode: string
    sdkMaxRetries: number
    maxHttpRequestsPerPermit: number
    possibleDispatchBoundary: string
    successStatus: number
    successMediaTypeProfile: string
    clientRequestIdProfile: string
  }>
  /** How a response's token counts are read and what is refused. */
  usage: Readonly<{ profile: string }>
  /** How a status or a refusal becomes one of RepKey's dispositions. */
  dispositions: Readonly<{
    profile: string
    retryableCompleteStatuses: readonly number[]
    retryAfterProfile: string
  }>
  pricing: AiProviderPriceCatalogue
  /** What bounds the call rate: our admission lanes, and what the provider's answer may say. */
  rateLimit: Readonly<{ admission: string; retryAfterProfile: string }>
  /** What the provider says it does with the data, as evidence retrieved on a date. */
  posture: Readonly<{ claimsDigest: string; retrievalDate: string }>
}>

export type AiProviderAttestation = AiProviderAttestationFacts &
  Readonly<{ attestationVersion: typeof AI_PROVIDER_ATTESTATION_VERSION; digest: string }>

function digestOf(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(domain, 'utf8')
    .update(canonicalizeRfc8785(value), 'utf8')
    .digest('hex')
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

/** Seals the facts with a digest over every one of them. */
export function defineProviderAttestation(
  facts: AiProviderAttestationFacts,
): AiProviderAttestation {
  const body = { attestationVersion: AI_PROVIDER_ATTESTATION_VERSION, ...facts }
  return deepFreeze({
    ...body,
    digest: digestOf('repkey-ai-provider-attestation-v1\0', body),
  })
}

/** What an operation row records about the request: model, kind and exact digest. */
export function providerRequestProfileOf(
  attestation: AiProviderAttestation,
): Readonly<{ model: string; version: string; digest: string }> {
  return Object.freeze({
    model: attestation.model,
    version: attestation.requestProfileVersion,
    digest: attestation.digest,
  })
}

/**
 * One logical profile as one provider carries it: the wire schema it derives from
 * the profile's answer schema, and the tokens its static request holds before any
 * payload byte, which a reservation prices.
 */
export type AiOperationProviderPairing = Readonly<{
  providerId: AiProviderId
  logicalDigest: string
  attestationDigest: string
  schemaTransform: Pinned
  staticTokenBearing: Readonly<{ bytes: number; digest: string }>
  digest: string
}>

export function defineOperationProviderPairing(
  input: Omit<AiOperationProviderPairing, 'digest'>,
): AiOperationProviderPairing {
  return deepFreeze({
    ...input,
    digest: digestOf('repkey-ai-operation-provider-pairing-v1\0', input),
  })
}

/**
 * The deployment profile that names every provider a deployment may use (contract
 * section 7.1, `private-beta-global-v2`). Choosing one of them is not a change to
 * it; adding, removing or re-attesting one is.
 */
export type AiProviderDeploymentEnvelope = Readonly<{
  profileVersion: string
  region: string
  providers: Readonly<Partial<Record<AiProviderId, string>>>
  profileDigest: string
}>

export function defineProviderDeploymentEnvelope(
  input: Readonly<{
    profileVersion: string
    region: string
    attestations: readonly AiProviderAttestation[]
  }>,
): AiProviderDeploymentEnvelope {
  if (input.attestations.length === 0) {
    throw new TypeError('a deployment profile names at least one provider')
  }
  const providers: Partial<Record<AiProviderId, string>> = {}
  for (const attestation of input.attestations) {
    if (providers[attestation.providerId] !== undefined) {
      throw new TypeError(`provider ${attestation.providerId} is attested twice`)
    }
    const { digest, ...facts } = attestation
    if (digestOf('repkey-ai-provider-attestation-v1\0', facts) !== digest) {
      throw new TypeError(`the attestation of ${attestation.providerId} is not sealed`)
    }
    providers[attestation.providerId] = digest
  }
  const body = {
    profileVersion: input.profileVersion,
    region: input.region,
    providers,
  }
  return deepFreeze({
    ...body,
    profileDigest: digestOf('repkey-ai-provider-deployment-envelope-v1\0', body),
  })
}
