// The split of an operation profile into a logical profile and a provider's pairing
// is lossless: every profile in force survives it with every digest intact. That is
// the evidence that OpenAI's facts moved out of the profile and nothing else did.

import { describe, expect, it } from 'vitest'
import {
  defineLogicalOperationProfile,
  type LogicalOperationProfile,
  type LogicalOperationProfileSource,
} from './ai-logical-operation-profile'
import {
  OPENAI_PROVIDER_ATTESTATION_V1,
  openAiPairingOf,
  openAiAttestationOf,
} from './ai-openai-provider-attestation'
import {
  logicalOperationProfileOf,
  operationProfileForCatalogue,
} from './ai-operation-profile-views'
import { AI_OPERATION_PROFILES } from './ai-operation-profiles'
import { defineProviderAttestation } from './ai-provider-attestations'

const [, ...OTHER_PROFILES] = AI_OPERATION_PROFILES
const ALL_PROFILES = AI_OPERATION_PROFILES

describe.each(ALL_PROFILES.map((profile) => [profile.profileVersion, profile] as const))(
  'the %s profile seen as a logical profile and OpenAI',
  (_version, profile) => {
    const logical = logicalOperationProfileOf(profile)
    const pairing = openAiPairingOf(logical)
    const attestation = openAiAttestationOf(logical)

    it('keeps the schema, the prompt and every limit as they were', () => {
      expect(logical.outputSchemaDigest).toBe(profile.outputSchemaDigest)
      expect(logical.promptDigest).toBe(profile.promptDigest)
      expect(logical.outputSchema).toEqual(profile.outputSchema)
      expect(logical.developerPrompt).toBe(profile.developerPrompt)
      expect(logical.limits).toEqual({
        sourceByteLimit: profile.sourceByteLimit,
        providerPayloadByteLimit: profile.providerPayloadByteLimit,
        preparedRequestByteLimit: profile.preparedRequestByteLimit,
        responseByteLimit: profile.responseByteLimit,
        maxOutputTokens: profile.maxOutputTokens,
        reasoningEffort: profile.reasoningEffort,
        providerDeadlineMs: profile.providerDeadlineMs,
        requestDeadlineMs: profile.requestDeadlineMs,
        executionLeaseMs: profile.executionLeaseMs,
      })
    })

    it('leaves OpenAI out of the logical artifacts and keeps the rest', () => {
      const { sdk: _sdk, ...withoutProvider } = profile.artifactAttestations

      expect(logical.logicalArtifacts).toEqual(withoutProvider)
      expect(logical.logicalArtifacts).not.toHaveProperty('sdk')
      expect(JSON.stringify(logical)).not.toMatch(/openai/iu)
    })

    it("moves OpenAI's request shape and reserved tokens to the attestation and the pairing, unchanged", () => {
      expect(attestation.requestShape.digest).toBe(profile.sdkRequestShapeDigest)
      expect(profile.artifactAttestations.sdk).toMatchObject({
        requestShapeVersion: attestation.requestShape.version,
        requestShapeDigest: attestation.requestShape.digest,
      })
      expect(pairing.staticTokenBearing).toEqual({
        bytes: profile.staticTokenBearingBytes,
        digest: profile.staticTokenBearingDigest,
      })
      expect(pairing.providerId).toBe('openai')
      expect(pairing.logicalDigest).toBe(logical.logicalDigest)
      expect(pairing.attestationDigest).toBe(attestation.digest)
    })

    it('comes back as the same catalogue entry, every digest included', () => {
      const rebuilt = operationProfileForCatalogue(logical, pairing)

      expect(rebuilt).toEqual(profile)
      expect(rebuilt.profileDigest).toBe(profile.profileDigest)
      expect(rebuilt.artifactAttestationsDigest).toBe(profile.artifactAttestationsDigest)
      expect(rebuilt.sdkRequestShapeDigest).toBe(profile.sdkRequestShapeDigest)
      expect(rebuilt.staticTokenBearingDigest).toBe(profile.staticTokenBearingDigest)
    })
  },
)

describe('what moves which digest', () => {
  const [analysis] = ALL_PROFILES
  const logical = logicalOperationProfileOf(analysis!)

  function redefine(
    change: Partial<LogicalOperationProfileSource>,
  ): LogicalOperationProfile {
    const {
      logicalDigest: _a,
      outputSchemaDigest: _b,
      promptDigest: _c,
      logicalArtifactsDigest: _d,
      ...source
    } = logical
    return defineLogicalOperationProfile({ ...source, ...change })
  }

  it('moves the logical digest for the prompt, the schema, an artifact or a limit', () => {
    const moved = [
      redefine({ developerPrompt: `${logical.developerPrompt} More.` }),
      redefine({ outputSchema: { ...logical.outputSchema, title: 'changed' } }),
      redefine({
        logicalArtifacts: { ...logical.logicalArtifacts, normalizerVersion: 'x' },
      }),
      redefine({
        limits: {
          ...logical.limits,
          maxOutputTokens: logical.limits.maxOutputTokens + 1,
        },
      }),
      redefine({ capabilityRuntimeProfileVersion: 'review-analysis-runtime-v2' }),
    ]

    for (const profile of moved)
      expect(profile.logicalDigest).not.toBe(logical.logicalDigest)
    expect(new Set(moved.map((profile) => profile.logicalDigest)).size).toBe(moved.length)
  })

  it('moves no logical digest when a provider changes anything about itself', () => {
    const reattested = defineProviderAttestation({
      ...OPENAI_PROVIDER_ATTESTATION_V1,
      sdk: { name: 'openai', version: '9.9.9' },
      pricing: { ...OPENAI_PROVIDER_ATTESTATION_V1.pricing, outputMicros: 1 },
    })

    expect(reattested.digest).not.toBe(OPENAI_PROVIDER_ATTESTATION_V1.digest)
    // The logical profile has no input a provider could change.
    expect(logicalOperationProfileOf(analysis!).logicalDigest).toBe(logical.logicalDigest)
    expect(Object.keys(logical)).not.toContain('attestation')
  })

  it('moves no attestation digest when the operation changes', () => {
    const edited = redefine({ developerPrompt: 'a different prompt' })

    expect(edited.logicalDigest).not.toBe(logical.logicalDigest)
    expect(OPENAI_PROVIDER_ATTESTATION_V1.digest).toBe(
      OPENAI_PROVIDER_ATTESTATION_V1.digest,
    )
    expect(openAiPairingOf(edited).attestationDigest).toBe(
      openAiPairingOf(logical).attestationDigest,
    )
    // What does move is what a reservation prices: the tokens in a longer prompt.
    expect(openAiPairingOf(edited).staticTokenBearing.digest).not.toBe(
      openAiPairingOf(logical).staticTokenBearing.digest,
    )
  })

  it('gives every profile its own logical digest', () => {
    const digests = ALL_PROFILES.map(
      (profile) => logicalOperationProfileOf(profile).logicalDigest,
    )
    expect(new Set(digests).size).toBe(ALL_PROFILES.length)
    expect(OTHER_PROFILES).toHaveLength(ALL_PROFILES.length - 1)
  })

  it('freezes what it returns', () => {
    expect(Object.isFrozen(logical)).toBe(true)
    expect(Object.isFrozen(logical.limits)).toBe(true)
    expect(Object.isFrozen(logical.logicalArtifacts)).toBe(true)
  })
})

describe('putting a logical profile into the catalogue', () => {
  const [analysis, reply] = ALL_PROFILES
  const logical = logicalOperationProfileOf(analysis!)
  const pairing = openAiPairingOf(logical)

  it('refuses a pairing made for another profile', () => {
    const other = openAiPairingOf(logicalOperationProfileOf(reply!))

    expect(() => operationProfileForCatalogue(logical, other)).toThrow(
      'the pairing is not this profile served by OpenAI',
    )
  })

  it('refuses a pairing that is not OpenAI, since the entry is OpenAI-shaped', () => {
    expect(() =>
      operationProfileForCatalogue(logical, { ...pairing, providerId: 'anthropic' }),
    ).toThrow('the pairing is not this profile served by OpenAI')
  })

  it('refuses a pairing that reserves tokens this profile does not send', () => {
    expect(() =>
      operationProfileForCatalogue(logical, {
        ...pairing,
        staticTokenBearing: {
          ...pairing.staticTokenBearing,
          bytes: pairing.staticTokenBearing.bytes + 1,
        },
      }),
    ).toThrow('the pairing reserves tokens this profile does not send')
  })
})
