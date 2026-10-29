import { describe, expect, it } from 'vitest'
import {
  AI_PROVIDER_ATTESTATION_VERSION,
  defineOperationProviderPairing,
  defineProviderAttestation,
  defineProviderDeploymentEnvelope,
  providerRequestProfileOf,
  type AiProviderAttestationFacts,
} from './ai-provider-attestations'
import { OPENAI_PROVIDER_ATTESTATION_V1 } from './ai-openai-provider-attestation'
import {
  AI_PROVIDER_DEPLOYMENT_PROFILE,
  OPENAI_REQUEST_SHAPE_V1_DIGEST,
} from './ai-operation-profiles'
import {
  OPENAI_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1,
  OPENAI_PRICE_CATALOGUE_V1,
} from './ai-openai-provider-profile'

const {
  digest: _digest,
  attestationVersion: _version,
  ...OPENAI_FACTS
} = OPENAI_PROVIDER_ATTESTATION_V1

/** A second provider, entirely synthetic: the seam must not care which one it is. */
const SECOND_FACTS: AiProviderAttestationFacts = {
  ...OPENAI_FACTS,
  providerId: 'anthropic',
  requestProfileVersion: 'synthetic-messages-request-profile-v1',
  model: 'synthetic-model-2026-10-01',
  adapter: { name: 'synthetic-messages-adapter', version: 'v1' },
  sdk: { name: 'synthetic-sdk', version: '1.2.3' },
  requestShape: {
    version: 'synthetic-messages-request-shape-v1',
    digest: 'b'.repeat(64),
  },
  pricing: { ...OPENAI_PRICE_CATALOGUE_V1, catalogueId: 'synthetic-prices' },
}

describe('OpenAI attestation', () => {
  it('restates what the deployment contract already pins and claims nothing else', () => {
    const attestation = OPENAI_PROVIDER_ATTESTATION_V1

    expect(attestation.attestationVersion).toBe(AI_PROVIDER_ATTESTATION_VERSION)
    expect(attestation.providerId).toBe('openai')
    expect(attestation.model).toBe(AI_PROVIDER_DEPLOYMENT_PROFILE.modelSnapshot)
    expect(attestation.sdk).toEqual({
      name: 'openai',
      version: AI_PROVIDER_DEPLOYMENT_PROFILE.deploymentContract.sdkVersion,
    })
    expect(attestation.requestShape.digest).toBe(OPENAI_REQUEST_SHAPE_V1_DIGEST)
    expect(attestation.transport).toMatchObject({
      endpoint: AI_PROVIDER_DEPLOYMENT_PROFILE.deploymentContract.endpoint,
      redirectMode: 'manual_no_follow',
      sdkMaxRetries: 0,
      maxHttpRequestsPerPermit: 1,
      possibleDispatchBoundary: 'outbound_fetch_invocation',
      successStatus: 200,
    })
    expect(attestation.dispositions).toEqual({
      profile: 'openai-status-disposition-v1',
      retryableCompleteStatuses: [429, 500, 502, 503, 504],
      retryAfterProfile: 'delta-seconds-1-to-300-v1',
    })
    expect(attestation.pricing).toBe(OPENAI_PRICE_CATALOGUE_V1)
    expect(attestation.posture.claimsDigest).toBe(
      OPENAI_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1,
    )
    expect(attestation.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(Object.isFrozen(attestation)).toBe(true)
    expect(Object.isFrozen(attestation.transport)).toBe(true)
  })

  it('records the model, the kind of request profile and its exact digest on an operation', () => {
    expect(providerRequestProfileOf(OPENAI_PROVIDER_ATTESTATION_V1)).toEqual({
      model: 'gpt-5.6-luna',
      version: 'openai-responses-request-profile-v1',
      digest: OPENAI_PROVIDER_ATTESTATION_V1.digest,
    })
  })
})

describe('sealing an attestation', () => {
  it('derives the same digest from the same facts, whatever order they are written in', () => {
    const reordered = Object.fromEntries(
      Object.entries(OPENAI_FACTS).reverse(),
    ) as AiProviderAttestationFacts

    expect(defineProviderAttestation(reordered).digest).toBe(
      OPENAI_PROVIDER_ATTESTATION_V1.digest,
    )
  })

  it('moves the digest when any fact a reviewer would compare with the code moves', () => {
    const variants: ReadonlyArray<readonly [string, AiProviderAttestationFacts]> = [
      ['model', { ...OPENAI_FACTS, model: 'gpt-5.6-luna-2' }],
      ['sdk version', { ...OPENAI_FACTS, sdk: { name: 'openai', version: '7.44.0' } }],
      [
        'adapter',
        { ...OPENAI_FACTS, adapter: { name: 'openai-responses-adapter', version: 'v2' } },
      ],
      [
        'request shape',
        {
          ...OPENAI_FACTS,
          requestShape: { ...OPENAI_FACTS.requestShape, digest: 'c'.repeat(64) },
        },
      ],
      [
        'endpoint',
        {
          ...OPENAI_FACTS,
          transport: { ...OPENAI_FACTS.transport, endpoint: 'https://example.invalid' },
        },
      ],
      [
        'dns policy',
        { ...OPENAI_FACTS, transport: { ...OPENAI_FACTS.transport, dnsPolicy: 'other' } },
      ],
      [
        'header profile',
        {
          ...OPENAI_FACTS,
          transport: { ...OPENAI_FACTS.transport, headerProfile: 'other' },
        },
      ],
      ['usage mapping', { ...OPENAI_FACTS, usage: { profile: 'other' } }],
      [
        'status mapping',
        {
          ...OPENAI_FACTS,
          dispositions: {
            ...OPENAI_FACTS.dispositions,
            retryableCompleteStatuses: [429],
          },
        },
      ],
      [
        'price list',
        { ...OPENAI_FACTS, pricing: { ...OPENAI_FACTS.pricing, outputMicros: 1 } },
      ],
      [
        'rate limit',
        { ...OPENAI_FACTS, rateLimit: { ...OPENAI_FACTS.rateLimit, admission: 'other' } },
      ],
      [
        'posture',
        {
          ...OPENAI_FACTS,
          posture: { ...OPENAI_FACTS.posture, retrievalDate: '2027-01-01' },
        },
      ],
      ['request profile name', { ...OPENAI_FACTS, requestProfileVersion: 'other' }],
    ]

    const digests = new Set([OPENAI_PROVIDER_ATTESTATION_V1.digest])
    for (const [name, facts] of variants) {
      const sealed = defineProviderAttestation(facts)
      expect(sealed.digest, name).not.toBe(OPENAI_PROVIDER_ATTESTATION_V1.digest)
      digests.add(sealed.digest)
    }
    expect(digests.size).toBe(variants.length + 1)
  })
})

describe('pairing a provider with an operation profile', () => {
  const input = {
    providerId: 'openai',
    logicalDigest: 'a'.repeat(64),
    attestationDigest: OPENAI_PROVIDER_ATTESTATION_V1.digest,
    schemaTransform: { version: 'identity-v1', digest: 'd'.repeat(64) },
    staticTokenBearing: { bytes: 2_193, digest: 'e'.repeat(64) },
  } as const

  it('seals the profile, the provider, the wire schema and the reserved tokens together', () => {
    const pairing = defineOperationProviderPairing(input)
    const moved = [
      defineOperationProviderPairing({ ...input, logicalDigest: 'f'.repeat(64) }),
      defineOperationProviderPairing({ ...input, attestationDigest: 'f'.repeat(64) }),
      defineOperationProviderPairing({
        ...input,
        schemaTransform: { ...input.schemaTransform, digest: 'f'.repeat(64) },
      }),
      defineOperationProviderPairing({
        ...input,
        staticTokenBearing: { ...input.staticTokenBearing, bytes: 2_194 },
      }),
    ]

    expect(pairing.digest).toMatch(/^[0-9a-f]{64}$/)
    for (const other of moved) expect(other.digest).not.toBe(pairing.digest)
    expect(Object.isFrozen(pairing)).toBe(true)
  })
})

describe('the deployment profile that names every provider', () => {
  const openAi = OPENAI_PROVIDER_ATTESTATION_V1
  const second = defineProviderAttestation(SECOND_FACTS)
  const base = { profileVersion: 'private-beta-global-v2', region: 'global' }

  it('names a provider by the digest of its attestation', () => {
    const one = defineProviderDeploymentEnvelope({ ...base, attestations: [openAi] })

    expect(one.providers).toEqual({ openai: openAi.digest })
    expect(one.profileDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(Object.isFrozen(one)).toBe(true)
  })

  it('is the same envelope whichever provider is listed first', () => {
    const forwards = defineProviderDeploymentEnvelope({
      ...base,
      attestations: [openAi, second],
    })
    const backwards = defineProviderDeploymentEnvelope({
      ...base,
      attestations: [second, openAi],
    })

    expect(forwards.providers).toEqual({
      openai: openAi.digest,
      anthropic: second.digest,
    })
    expect(forwards.profileDigest).toBe(backwards.profileDigest)
  })

  it('changes when a provider is added, removed or re-attested, and only then', () => {
    const one = defineProviderDeploymentEnvelope({ ...base, attestations: [openAi] })
    const two = defineProviderDeploymentEnvelope({
      ...base,
      attestations: [openAi, second],
    })
    const reattested = defineProviderDeploymentEnvelope({
      ...base,
      attestations: [
        openAi,
        defineProviderAttestation({
          ...SECOND_FACTS,
          sdk: { name: 'synthetic-sdk', version: '1.2.4' },
        }),
      ],
    })

    expect(
      new Set([one.profileDigest, two.profileDigest, reattested.profileDigest]).size,
    ).toBe(3)
    // The operator's choice is not an input: there is nowhere to put it.
    expect(Object.keys(two)).toEqual([
      'profileVersion',
      'region',
      'providers',
      'profileDigest',
    ])
  })

  it('refuses no provider, a provider twice and an attestation that was edited after it was sealed', () => {
    expect(() => defineProviderDeploymentEnvelope({ ...base, attestations: [] })).toThrow(
      'at least one provider',
    )
    expect(() =>
      defineProviderDeploymentEnvelope({ ...base, attestations: [openAi, openAi] }),
    ).toThrow('attested twice')
    const edited = { ...openAi, model: 'edited' }
    expect(() =>
      defineProviderDeploymentEnvelope({ ...base, attestations: [edited] }),
    ).toThrow('not sealed')
  })
})
