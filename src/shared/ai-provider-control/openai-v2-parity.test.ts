// What OpenAI is sent, and what pins the profiles that send it, for every route in
// the live catalogue.
//
// The literals were first produced at commit 7465a2e51, the parent of the evidence
// request path and of the provider seam, and the test passed unchanged there and after
// the seam, which was the evidence that the seam moved code and changed no behaviour for
// v2. They were taken again at the switch-on of review analysis v3 (2026-10-30), on
// purpose and for these reasons only:
//   - the model is `gpt-6-luna` (was `gpt-5.6-luna`), so the request shape digest, the
//     provider claims, every profile's SDK attestation and every body moved;
//   - the deployment profile is `private-beta-global-v2`, so the deployment profile and
//     routing policy digests and every request binding moved;
//   - the reservations moved with the price list ($0.10 / $0.01 / $0.50 per million);
//   - review analysis is served as v3: the `analysis` route below is a v3 request, and
//     the catalogue carries the retired v2 profile (unchanged except for the shape
//     digest) and the v3 profile.
// For reply and trend the body differs from the earlier one by the model name alone
// (two bytes shorter); their sources, payloads, shards and limits other than the price
// are the earlier ones. A change that moves any of these is a change to a live contract
// and must say so by editing this file in the same commit, with its reason.

import { createHash, generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AI_OPERATION_PROFILES,
  AI_PROVIDER_DEPLOYMENT_PROFILE,
  AI_ROUTING_POLICY,
  OPENAI_REQUEST_SHAPE_V1_DIGEST,
} from '#/shared/ai-operation-profiles'
import { OPENAI_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1 } from '#/shared/ai-openai-provider-profile'
import { parseAiGatewayRouteRequest } from '#/shared/ai-gateway-transport-contract'
import {
  replyRequest,
  trendRequest,
} from '#/shared/ai-gateway-transport-contract.test-fixtures'
import { LANGUAGE_CATALOGUE_DIGEST } from '#/shared/ai-review-language-catalogue'
import {
  AI_REVIEW_LANGUAGE_REGION_ICU_VERSION,
  AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
  AI_REVIEW_LANGUAGE_REGION_UNICODE_VERSION,
} from '#/shared/generated/ai-review-language-canonical-regions-v1'
import { AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST } from '#/shared/ai-reply-language-verifier'
import { AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST } from '#/shared/ai-language-script-consistency'
import { AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST } from '#/shared/ai-zh-orthography-verifier'
import {
  AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
  AI_REPLY_TEMPLATE_CATALOGUE_VERSION,
} from '#/shared/ai-reply-template-catalogue'
import {
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
} from '#/shared/ai-reply-output-leakage'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import { createAiGatewayRoutePreparer } from './route-preparer'
import { preparableV3Request } from './review-evidence.test-fixtures'

const PINNED_PROFILES = [
  {
    profileVersion: 'review-analysis-v2',
    profileDigest: '4bd359d6311640ef1928db3221f1a9099e589af26c0c7a5aa80d6183eeb86b5e',
    outputSchemaDigest:
      '02ad42ae83c2f271c8456e7e64169a5df965234b039bbc0174e0a54f9e6997ff',
    promptDigest: 'bccf973cb60cdda3cc69ed747f841fe2a51b8f33b0c454f606a701ae6bbcb129',
    artifactAttestationsDigest:
      'e0a68671ec711e35c45768fbf598aad343b32c8648f8af57e76abb8318113073',
    sdkRequestShapeDigest:
      '0bf52569683db47a551f212b33a8e19dfdd768f0a70047740b5f57a72c11ce37',
    staticTokenBearingBytes: 2193,
    staticTokenBearingDigest:
      '71ba0a028c787002b209b8119df3daa473dd9376a1d3e6e63684dfdcb2fc98d5',
  },
  {
    profileVersion: 'reply-suggestion-v1',
    profileDigest: '1f229a4518348ca31382608e52c601c33ce65f38d77278236bc5204e024e7c18',
    outputSchemaDigest:
      'e8c29f4e2fd80391fbb483390e671dd0c4c5b639b1d1ec85e9d018ab90c33d35',
    promptDigest: '8e6c3e5f88d43c83098763e29cb0d159a0d23fd520fa9e7105e7e6adbc527b0d',
    artifactAttestationsDigest:
      'd93bd2274c7dfc80bfe77c6f1b88177db23348cc334a82005f7e9530821cc00c',
    sdkRequestShapeDigest:
      '0bf52569683db47a551f212b33a8e19dfdd768f0a70047740b5f57a72c11ce37',
    // ADR 0073: the reply prompt asks for the body only and no longer carries the
    // business name, so its prompt, profile and request pins moved on purpose.
    staticTokenBearingBytes: 1890,
    staticTokenBearingDigest:
      '6200bdab5c207fdd30999ba9d74a5faaf59db358d86a74e78c09f8148abea8ac',
  },
  {
    profileVersion: 'property-trend-v1',
    profileDigest: 'e6c9ed466112ea06466c422dd8c2b9167cb515f15cf6690a3d204be1fcbd3d45',
    outputSchemaDigest:
      '1e2b94e0c463c7605fe395e076b7783d25aa61202bd319372bee6d1b70dbb667',
    promptDigest: '30916252f5dd6860f4ce6f2bf50aba6345af4f39684ccb19aee728aa9fee7f64',
    artifactAttestationsDigest:
      'c3d828df3ab959cd3f15b3422b7067d101b362aa756d3e75f7978385aaf807f1',
    sdkRequestShapeDigest:
      '0bf52569683db47a551f212b33a8e19dfdd768f0a70047740b5f57a72c11ce37',
    staticTokenBearingBytes: 966,
    staticTokenBearingDigest:
      'ceaac2bb20b14aab430b566e7fc76b7a1c439b68605d59aed57e5b227b16ead9',
  },
  {
    profileVersion: 'synthetic-canary-v1',
    profileDigest: '6f986a1fe771b2d92d7e16acc09e39cc63aaba4a4f6a9203ad61a0412189f9f5',
    outputSchemaDigest:
      '9e4530ad830cf3635b0ee2b636141193524cf7db1a9de0d5d4f1530c16fe9bc7',
    promptDigest: '28f90dbd3fe4ed23ae32379e62fc9f6fdbfd25489a4eed63164e734ee94a3d8a',
    artifactAttestationsDigest:
      'fe233ac561fdb30ef1cd5babe3b10e70b9759eaacd28f6b42da4ba7266d2ce24',
    sdkRequestShapeDigest:
      '0bf52569683db47a551f212b33a8e19dfdd768f0a70047740b5f57a72c11ce37',
    staticTokenBearingBytes: 419,
    staticTokenBearingDigest:
      '11c7e44c309c144fa7ef7904710350bfeea1c829e36fa0b51ae736b9bdf02cf4',
  },
  {
    profileVersion: 'review-analysis-v3',
    profileDigest: 'e2abbbfab2b18ee88c75b9c63e9375258577486fcb6710b5f3f612972d53dd66',
    outputSchemaDigest:
      '8c72e79976c6b784c679f671b798c41b71e78795542c7d80571e48cebde40154',
    promptDigest: 'c912005966c45c7533a7fc9ba37f5b0fc70e7399a0555da360ce9fadab0cd1f3',
    artifactAttestationsDigest:
      '4f9db684f8a0b0dc0d844d62a8ef279e2e26b362b714cd3c5e5b970c6077f018',
    sdkRequestShapeDigest:
      '0bf52569683db47a551f212b33a8e19dfdd768f0a70047740b5f57a72c11ce37',
    staticTokenBearingBytes: 15920,
    staticTokenBearingDigest:
      'ddff7f36f771ef47aa3388620ba8bf6ffa96a81619749e11db62f38b01c00afc',
  },
] as const

const PINNED_PROVIDER_LEVEL = {
  deploymentProfileDigest:
    '07a1b133ea2c519ed61fc18ca376cc7e4494b48bbf738d5705739293722962b3',
  routingPolicyDigest: 'dce9ee5026db127ea4405639caa35e650aa8c6f29632220b1347f4f381e366ca',
  requestShapeDigest: '0bf52569683db47a551f212b33a8e19dfdd768f0a70047740b5f57a72c11ce37',
  normalizedClaimsDigest:
    '33aebd2c6985580b83ea6ccab6b3f0157bc1a17cc3e186eae3c076bfe09ac9ef',
} as const

const PINNED_ROUTES = {
  analysis: {
    sourceDigest: '40eb9e177955783972f0271b399a23bfc949deef751adcb80db6caaa666ee3f2',
    preparedDigest: '78cc2c7d8d795f50640a81ff34b2340612ba6fe01ce476d96f564d417f298805',
    sourceByteCount: 97,
    preparedByteCount: 18090,
    providerPayloadByteCount: 1561,
    promptCacheShard: 9,
    limits: {
      sourceBytes: 16384,
      providerPayloadBytes: 57344,
      preparedRequestBytes: 131072,
      responseBytes: 131072,
      outputTokens: 4096,
      costMicros: 3797,
    },
    requestBindingKeyId: 'request-v1',
    requestBindingHmac: 'H93J-0k0aKRvvTpVtOCO4lIFUFKBW5A9ttVZ7Xk_Epo',
    canonicalProviderBytesSha256:
      'b6f063d3da8527243da1bb8ade4597edb704afb8031fb7d162f207ae558c6dc4',
    canonicalProviderByteLength: 18090,
  },
  reply: {
    sourceDigest: '916622962728c9a3a2ad6c2e44fc2e47e777d9420a0b13c66c8ae576a596d14d',
    preparedDigest: 'b6971bb9e6cf5bee98523441f17b00a3198a713ba11a910aeafbb7d059faa5d5',
    sourceByteCount: 86,
    preparedByteCount: 2441,
    providerPayloadByteCount: 178,
    promptCacheShard: 15,
    limits: {
      sourceBytes: 16384,
      providerPayloadBytes: 16384,
      preparedRequestBytes: 65536,
      responseBytes: 131072,
      outputTokens: 1024,
      costMicros: 719,
    },
    requestBindingKeyId: 'request-v1',
    requestBindingHmac: '2s7rTr-vYNP0K2nsK70I6RFv54wJZrCxXCpvQ4gI0iI',
    canonicalProviderBytesSha256:
      'b4cb8a3a87ff7777837bcb997c816e1d3849f32f3c867af03b042f0d290f2d23',
    canonicalProviderByteLength: 2441,
  },
  trend: {
    sourceDigest: 'c42fb3d5198ee5e97b829f07bcccfb36ab0b823de3538d2971b29397780289db',
    preparedDigest: 'b94879798f76a112017b37445d98fb75c2210cf82b3cf135d1fd02ea79b99d27',
    sourceByteCount: 1456,
    preparedByteCount: 2962,
    providerPayloadByteCount: 1455,
    promptCacheShard: 0,
    limits: {
      sourceBytes: 65536,
      providerPayloadBytes: 65536,
      preparedRequestBytes: 131072,
      responseBytes: 131072,
      outputTokens: 2048,
      costMicros: 1267,
    },
    requestBindingKeyId: 'request-v1',
    requestBindingHmac: '9esk-eyWRd1L9TkyvNHgqnvuo6kY19f1SUi3_jM9LpQ',
    canonicalProviderBytesSha256:
      '1ccada2805a47972a921007fc81325b31652b42dd632382239b535893ee6372e',
    canonicalProviderByteLength: 2962,
  },
} as const

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

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function preparer() {
  return createAiGatewayRoutePreparer({
    requestBindingKeys: createVersionedHmacKeyring(`request-v1:${'11'.repeat(32)}`),
    safetyIdentifierKey: Buffer.alloc(32, 7),
    replyLanguageDetector: {
      detect: (text: string) => ({
        language: /[\u0400-\u04ff]/u.test(text) ? 'bg' : 'tr',
        probability: 1,
        reliable: true,
      }),
    },
    provenanceKid: 'provenance-v1',
    provenancePrivateKey: generateKeyPairSync('ed25519').privateKey,
  })
}

function liveAnalysis() {
  return parseAiGatewayRouteRequest(preparableV3Request())
}

function liveReply() {
  const base = replyRequest()
  return parseAiGatewayRouteRequest({
    ...base,
    binding: {
      ...base.binding,
      evaluatedLanguage: 'tr-Latn',
      languageCatalogueDigest: LANGUAGE_CATALOGUE_DIGEST,
      concreteReplyLanguage: { tag: 'bg-Cyrl-BG', templateGroup: 'bg-Cyrl' },
      replyLanguageVerifierDigest: AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST,
      languageScriptConsistencyDigest: AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST,
      zhOrthographyVerifierDigest: AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST,
      outputLeakageProfileVersion: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
      outputLeakageProfileDigest: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
      replyTemplateCatalogueVersion: AI_REPLY_TEMPLATE_CATALOGUE_VERSION,
      replyTemplateCatalogueDigest: AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
    },
    source: {
      ...base.source,
      text: 'Konaklamamız boyunca personel çok ilgili ve yardımseverdi.',
      languageCode: 'tr-TR',
    },
  })
}

describe('OpenAI and the live profiles, as pinned at the switch-on', () => {
  it('keeps every digest of every profile in the live catalogue', () => {
    expect(
      AI_OPERATION_PROFILES.map((profile) => ({
        profileVersion: profile.profileVersion,
        profileDigest: profile.profileDigest,
        outputSchemaDigest: profile.outputSchemaDigest,
        promptDigest: profile.promptDigest,
        artifactAttestationsDigest: profile.artifactAttestationsDigest,
        sdkRequestShapeDigest: profile.sdkRequestShapeDigest,
        staticTokenBearingBytes: profile.staticTokenBearingBytes,
        staticTokenBearingDigest: profile.staticTokenBearingDigest,
      })),
    ).toEqual(PINNED_PROFILES)
  })

  it('keeps the deployment profile, the routing policy, the request shape and the provider evidence', () => {
    expect({
      deploymentProfileDigest: AI_PROVIDER_DEPLOYMENT_PROFILE.profileDigest,
      routingPolicyDigest: AI_ROUTING_POLICY.policyDigest,
      requestShapeDigest: OPENAI_REQUEST_SHAPE_V1_DIGEST,
      normalizedClaimsDigest: OPENAI_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1,
    }).toEqual(PINNED_PROVIDER_LEVEL)
  })

  it.each([
    ['analysis', liveAnalysis],
    ['reply', liveReply],
    ['trend', () => parseAiGatewayRouteRequest(trendRequest())],
  ] as const)(
    'sends OpenAI byte for byte the %s body, under the same descriptor, limits and request binding',
    (route, request) => {
      const { invocation } = preparer().prepare(request())
      const pinned = PINNED_ROUTES[route]
      const descriptor = invocation.descriptor

      expect({
        sourceDigest: descriptor.sourceDigest,
        preparedDigest: descriptor.preparedDigest,
        sourceByteCount: descriptor.sourceByteCount,
        preparedByteCount: descriptor.preparedByteCount,
        providerPayloadByteCount: descriptor.providerPayloadByteCount,
        promptCacheShard: descriptor.promptCacheShard,
        limits: descriptor.limits,
        requestBindingKeyId: invocation.requestBindingKeyId,
        requestBindingHmac: invocation.requestBindingHmac,
        canonicalProviderBytesSha256: sha256(invocation.canonicalProviderBytes),
        canonicalProviderByteLength: invocation.canonicalProviderBytes.byteLength,
      }).toEqual(pinned)
    },
  )
})
