// The route preparer meets the provider seam: which provider shapes a request, who
// chooses it, and what it costs. A second provider is a test double here (it shapes
// the request the way OpenAI does and names itself otherwise), because the
// Anthropic adapter is slice 3.6; the preparer must not care which one it is.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analysisRequest } from '#/shared/ai-gateway-transport-contract.test-fixtures'
import { parseAiGatewayRouteRequest } from '#/shared/ai-gateway-transport-contract'
import { OPENAI_PROVIDER_ATTESTATION_V1 } from '#/shared/ai-openai-provider-attestation'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import { LANGUAGE_CATALOGUE_DIGEST } from '#/shared/ai-review-language-catalogue'
import {
  defineOperationProviderPairing,
  providerRequestProfileOf,
} from '#/shared/ai-provider-attestations'
import {
  maximumCostMicrosWith,
  type AiProviderPriceCatalogue,
} from '#/shared/ai-provider-pricing'
import { OPENAI_PRICE_CATALOGUE_V1 } from '#/shared/ai-openai-provider-profile'
import {
  AI_REVIEW_LANGUAGE_REGION_ICU_VERSION,
  AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
  AI_REVIEW_LANGUAGE_REGION_UNICODE_VERSION,
} from '#/shared/generated/ai-review-language-canonical-regions-v1'
import { GatewayPreparationError } from './contracts'
import { createOpenAiProviderPreparation } from './openai-provider-adapter'
import {
  evidencePreparer,
  preparableV3Request,
  v3TestProfile,
} from './review-evidence.test-fixtures'
import type {
  AiProviderPreparation,
  PrepareProviderInvocationInput,
} from './provider-contracts'
import {
  createAiProviderRegistry,
  type AiProviderSelectionConfig,
} from './provider-selection'
import type { PreparedAiInvocation } from './prepared-invocation'
import type { RoutePreparationProfile } from './route-preparer'

beforeEach(() => {
  vi.spyOn(process.versions, 'node', 'get').mockReturnValue(
    AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
  )
  vi.spyOn(process.versions, 'icu', 'get').mockReturnValue(
    AI_REVIEW_LANGUAGE_REGION_ICU_VERSION,
  )
  vi.spyOn(process.versions, 'unicode', 'get').mockReturnValue(
    AI_REVIEW_LANGUAGE_REGION_UNICODE_VERSION,
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

const SECOND_PRICES: AiProviderPriceCatalogue = Object.freeze({
  ...OPENAI_PRICE_CATALOGUE_V1,
  catalogueId: 'synthetic-second-provider-prices',
  uncachedInputMicros: 3_000_000,
  outputMicros: 15_000_000,
})

type Spy = AiProviderPreparation<PreparedAiInvocation> &
  Readonly<{ calls: PrepareProviderInvocationInput[] }>

/** A provider that is not OpenAI: it records what it is asked to shape and shapes it OpenAI's way. */
function secondProvider(
  overrides: Partial<Pick<AiProviderPreparation, 'requestProfile'>> & {
    ready?: boolean
  } = {},
): Spy & Readonly<{ readiness?: () => boolean }> {
  const inner = createOpenAiProviderPreparation()
  const calls: PrepareProviderInvocationInput[] = []
  return {
    providerId: 'anthropic',
    requestProfile: overrides.requestProfile ?? {
      model: 'synthetic-model-2026-10-01',
      version: 'synthetic-request-profile-v1',
      digest: 'b'.repeat(64),
    },
    pricing: SECOND_PRICES,
    calls,
    ...(overrides.ready === undefined
      ? {}
      : { readiness: () => overrides.ready as boolean }),
    prepare: (input) => {
      calls.push({ ...input, sourceBytes: Uint8Array.from(input.sourceBytes) })
      return inner.prepare(input)
    },
  }
}

function openAiSpy(): Spy {
  const inner = createOpenAiProviderPreparation()
  const calls: PrepareProviderInvocationInput[] = []
  return {
    ...inner,
    calls,
    prepare: (input) => {
      calls.push({ ...input, sourceBytes: Uint8Array.from(input.sourceBytes) })
      return inner.prepare(input)
    },
  }
}

/** The dark v3 profile, attested for both providers, as a catalogue holding it would have it. */
function bothProviders(): RoutePreparationProfile {
  const base = v3TestProfile()
  const pairing = defineOperationProviderPairing({
    providerId: 'anthropic',
    logicalDigest: 'a'.repeat(64),
    attestationDigest: 'c'.repeat(64),
    schemaTransform: { version: 'synthetic-v1', digest: 'd'.repeat(64) },
    // Not OpenAI's figure: what the second provider's own wrapper would reserve.
    staticTokenBearing: {
      bytes: base.staticTokenBearingBytes + 777,
      digest: 'e'.repeat(64),
    },
  })
  return {
    ...base,
    attestedProviders: ['openai', 'anthropic'],
    pairings: { anthropic: pairing },
  }
}

function claimed(
  request: ReturnType<typeof preparableV3Request>,
  provider: Spy | 'openai',
) {
  const profile =
    provider === 'openai'
      ? providerRequestProfileOf(OPENAI_PROVIDER_ATTESTATION_V1)
      : provider.requestProfile
  return {
    ...request,
    provider: {
      id: provider === 'openai' ? ('openai' as const) : provider.providerId,
      model: profile.model,
      requestProfileVersion: profile.version,
      requestProfileDigest: profile.digest,
    },
  }
}

function refusal(action: () => unknown): string {
  try {
    action()
  } catch (error) {
    if (error instanceof GatewayPreparationError) return error.code
    throw error
  }
  return 'prepared'
}

function preparerFor(
  adapters: readonly AiProviderPreparation<PreparedAiInvocation>[],
  selection: AiProviderSelectionConfig,
  profile: RoutePreparationProfile = bothProviders(),
) {
  return evidencePreparer({
    profiles: [profile],
    providers: createAiProviderRegistry(adapters, selection),
  })
}

describe('which provider shapes a request', () => {
  it('is OpenAI for every route in the live catalogue, with no operator choice to make', () => {
    const openAi = openAiSpy()
    const preparer = evidencePreparer({
      providers: createAiProviderRegistry([openAi], { review_analysis: 'anthropic' }),
    })
    const request = parseAiGatewayRouteRequest({
      ...analysisRequest(),
      binding: {
        ...analysisRequest().binding,
        languageCatalogueDigest: LANGUAGE_CATALOGUE_DIGEST,
      },
    })

    const prepared = preparer.prepare(request)

    expect(prepared.providerId).toBe('openai')
    expect(openAi.calls).toHaveLength(1)
    expect(
      AI_OPERATION_PROFILES.every((profile) => profile.sourceRoute !== undefined),
    ).toBe(true)
  })

  it('is the provider the operator chose, for a profile attested for both', () => {
    const openAi = openAiSpy()
    const second = secondProvider()
    const request = claimed(preparableV3Request(), second)

    const prepared = preparerFor([openAi, second], {
      review_analysis: 'anthropic',
    }).prepare(request)

    expect(prepared.providerId).toBe('anthropic')
    expect(second.calls).toHaveLength(1)
    expect(openAi.calls).toHaveLength(0)
  })

  it('moves with the operator, and only with the operator', () => {
    const request = (provider: Spy | 'openai') => claimed(preparableV3Request(), provider)
    const openAi = openAiSpy()
    const second = secondProvider()

    expect(
      preparerFor([openAi, second], { review_analysis: 'openai' }).prepare(
        request('openai'),
      ).providerId,
    ).toBe('openai')
    expect(
      preparerFor([openAi, second], { review_analysis: 'anthropic' }).prepare(
        request(second),
      ).providerId,
    ).toBe('anthropic')
  })

  it('refuses when the operator has chosen none, and asks no provider', () => {
    const openAi = openAiSpy()
    const second = secondProvider()

    expect(
      refusal(() =>
        preparerFor([openAi, second], {}).prepare(
          claimed(preparableV3Request(), 'openai'),
        ),
      ),
    ).toBe('policy_unavailable')
    expect(openAi.calls).toHaveLength(0)
    expect(second.calls).toHaveLength(0)
  })

  it('refuses when the chosen provider is down, and does not turn to the other', () => {
    const openAi = openAiSpy()
    const down = secondProvider({ ready: false })

    expect(
      refusal(() =>
        preparerFor([openAi, down], { review_analysis: 'anthropic' }).prepare(
          claimed(preparableV3Request(), down),
        ),
      ),
    ).toBe('provider_unavailable')
    expect(openAi.calls).toHaveLength(0)
    expect(down.calls).toHaveLength(0)
  })

  it('refuses when the chosen provider is not wired in this process', () => {
    const openAi = openAiSpy()

    expect(
      refusal(() =>
        preparerFor([openAi], { review_analysis: 'anthropic' }).prepare(
          claimed(preparableV3Request(), 'openai'),
        ),
      ),
    ).toBe('policy_unavailable')
    expect(openAi.calls).toHaveLength(0)
  })
})

describe('the provider an operation was claimed under', () => {
  const openAi = () => openAiSpy()

  it('is served only by that provider', () => {
    const second = secondProvider()
    const preparer = preparerFor([openAi(), second], { review_analysis: 'anthropic' })

    expect(refusal(() => preparer.prepare(claimed(preparableV3Request(), second)))).toBe(
      'prepared',
    )
  })

  it('ends when the operator has switched since the claim, whichever way', () => {
    const second = secondProvider()
    const toSecond = preparerFor([openAi(), second], { review_analysis: 'anthropic' })
    const toOpenAi = preparerFor([openAi(), second], { review_analysis: 'openai' })

    // Claimed under OpenAI, the operator now serves Anthropic ...
    expect(
      refusal(() => toSecond.prepare(claimed(preparableV3Request(), 'openai'))),
    ).toBe('provider_profile_changed')
    // ... and the other way round.
    expect(refusal(() => toOpenAi.prepare(claimed(preparableV3Request(), second)))).toBe(
      'provider_profile_changed',
    )
  })

  it('ends when the same provider has been re-attested since the claim', () => {
    const claimedUnder = secondProvider()
    const reattested = secondProvider({
      requestProfile: { ...claimedUnder.requestProfile, digest: 'f'.repeat(64) },
    })
    const preparer = preparerFor([openAi(), reattested], { review_analysis: 'anthropic' })
    const request = claimed(preparableV3Request(), claimedUnder)

    expect(refusal(() => preparer.prepare(request))).toBe('provider_profile_changed')
    expect(
      refusal(() =>
        preparer.prepare({
          ...request,
          provider: { ...request.provider, model: 'another-model' },
        }),
      ),
    ).toBe('provider_profile_changed')
    expect(
      refusal(() =>
        preparer.prepare({
          ...request,
          provider: { ...request.provider, requestProfileVersion: 'another-profile' },
        }),
      ),
    ).toBe('provider_profile_changed')
  })

  it('cannot be left unnamed when the profile is attested for several providers', () => {
    const second = secondProvider()
    const request = preparableV3Request()
    const { provider: _provider, ...withoutProvider } = request

    expect(
      refusal(() =>
        preparerFor([openAi(), second], { review_analysis: 'anthropic' }).prepare(
          withoutProvider as typeof request,
        ),
      ),
    ).toBe('invalid_request')
    expect(second.calls).toHaveLength(0)
  })
})

describe('what a request may cost', () => {
  it('is priced by the provider that will serve it, from the tokens its own wrapper reserves', () => {
    const second = secondProvider()
    const profile = bothProviders()
    const request = claimed(preparableV3Request(), second)

    const prepared = preparerFor([openAiSpy(), second], {
      review_analysis: 'anthropic',
    }).prepare(request)
    const descriptor = prepared.invocation.descriptor

    expect(descriptor.limits.costMicros).toBe(
      maximumCostMicrosWith(
        SECOND_PRICES,
        {
          staticTokenBearingBytes: profile.staticTokenBearingBytes + 777,
          maxOutputTokens: profile.maxOutputTokens,
        },
        descriptor.providerPayloadByteCount,
      ),
    )
  })

  it("is OpenAI's price and the profile's own figure when OpenAI serves it", () => {
    const profile = bothProviders()
    const request = claimed(preparableV3Request(), 'openai')

    const prepared = preparerFor([openAiSpy(), secondProvider()], {
      review_analysis: 'openai',
    }).prepare(request)

    expect(prepared.invocation.descriptor.limits.costMicros).toBe(
      maximumCostMicrosWith(
        OPENAI_PRICE_CATALOGUE_V1,
        {
          staticTokenBearingBytes: profile.staticTokenBearingBytes,
          maxOutputTokens: profile.maxOutputTokens,
        },
        prepared.invocation.descriptor.providerPayloadByteCount,
      ),
    )
  })

  it('moves with the provider for the same review', () => {
    const second = secondProvider()
    const viaOpenAi = preparerFor([openAiSpy(), second], {
      review_analysis: 'openai',
    }).prepare(claimed(preparableV3Request(), 'openai'))
    const viaSecond = preparerFor([openAiSpy(), second], {
      review_analysis: 'anthropic',
    }).prepare(claimed(preparableV3Request(), second))

    expect(viaSecond.invocation.descriptor.limits.costMicros).toBeGreaterThan(
      viaOpenAi.invocation.descriptor.limits.costMicros,
    )
  })
})
