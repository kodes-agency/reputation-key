// What OpenAI is sent, and what pins the profiles that send it, for every route in
// the live catalogue, as they were BEFORE the provider seam existed (commit
// 7465a2e51, the parent of the evidence request path and of the seam).
//
// Every literal below was produced by running this same preparation at that
// commit. The test passes unchanged there and here, which is the evidence that the
// seam moved code and changed no behaviour for v2: the same profile digests, the
// same deployment profile, the same limits and reservations, the same descriptor
// and request binding, and byte for byte the same body sent to OpenAI. A change that
// moves any of these is a change to a live contract and must say so by editing
// this file in the same commit, with its reason.

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
  analysisRequest,
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

const PINNED_PROFILES = [
  {
    profileVersion: 'review-analysis-v2',
    profileDigest: 'b0f75da6be2523c15502f5953f02da2e7af98a827eae997a4753f62ba9948f82',
    outputSchemaDigest:
      '02ad42ae83c2f271c8456e7e64169a5df965234b039bbc0174e0a54f9e6997ff',
    promptDigest: 'bccf973cb60cdda3cc69ed747f841fe2a51b8f33b0c454f606a701ae6bbcb129',
    artifactAttestationsDigest:
      '76a6550b809a24b22122a0ad0447f6561392633165829f5ba7ea0d99152c8974',
    sdkRequestShapeDigest:
      '69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd',
    staticTokenBearingBytes: 2193,
    staticTokenBearingDigest:
      '71ba0a028c787002b209b8119df3daa473dd9376a1d3e6e63684dfdcb2fc98d5',
  },
  {
    profileVersion: 'reply-suggestion-v1',
    profileDigest: '177d558263f0e60db1eb3b0a4073e3b7730545e580c887108fc5675c65b4a616',
    outputSchemaDigest:
      'e8c29f4e2fd80391fbb483390e671dd0c4c5b639b1d1ec85e9d018ab90c33d35',
    promptDigest: '4900b67b179ad3f2c9515dd107692399e3e7841aa4f01b243a413dfcf3b3282b',
    artifactAttestationsDigest:
      '08978a4ab1095266b2ff40f8dfad15d504a72f9b103e55d7a2f4303bf75efda7',
    sdkRequestShapeDigest:
      '69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd',
    staticTokenBearingBytes: 2115,
    staticTokenBearingDigest:
      '50c614c52ec43e3dca20078d3fcb55efa71bd32d8f0a22928485ca3c3b5f6e93',
  },
  {
    profileVersion: 'property-trend-v1',
    profileDigest: 'f9dbbbb4a3e7dc5bffb67781303911a69034e232d2f967009432a73ecf24e2c5',
    outputSchemaDigest:
      '1e2b94e0c463c7605fe395e076b7783d25aa61202bd319372bee6d1b70dbb667',
    promptDigest: '30916252f5dd6860f4ce6f2bf50aba6345af4f39684ccb19aee728aa9fee7f64',
    artifactAttestationsDigest:
      'c2f14560d412e2cdaebc6f33544d7343bf39c1f67ee796cb3a42d7cc6b2d73ea',
    sdkRequestShapeDigest:
      '69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd',
    staticTokenBearingBytes: 966,
    staticTokenBearingDigest:
      'ceaac2bb20b14aab430b566e7fc76b7a1c439b68605d59aed57e5b227b16ead9',
  },
  {
    profileVersion: 'synthetic-canary-v1',
    profileDigest: 'dd9997d6a1f88c11fb5b22bbaa8d449138345d05b2b7528f9f559ddad5b6fd17',
    outputSchemaDigest:
      '9e4530ad830cf3635b0ee2b636141193524cf7db1a9de0d5d4f1530c16fe9bc7',
    promptDigest: '28f90dbd3fe4ed23ae32379e62fc9f6fdbfd25489a4eed63164e734ee94a3d8a',
    artifactAttestationsDigest:
      'c70948b7f461c8c8128346cbae55c9128bdd1bc51a135df06200538a6334ab22',
    sdkRequestShapeDigest:
      '69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd',
    staticTokenBearingBytes: 419,
    staticTokenBearingDigest:
      '11c7e44c309c144fa7ef7904710350bfeea1c829e36fa0b51ae736b9bdf02cf4',
  },
] as const

const PINNED_PROVIDER_LEVEL = {
  deploymentProfileDigest:
    '0f285a480c7568905de2eb30746898c215687f6b7aa4ed16fe85f2cd1d5e1934',
  routingPolicyDigest: '8e464f1cff54fca49124bca418420d913088ccd675610149ef679bb4b2e83d66',
  requestShapeDigest: '69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd',
  normalizedClaimsDigest:
    'a6c41316f725644be569c2797f20941d2d04e39996b6a0d69d835d5e93f0b2c9',
} as const

const PINNED_ROUTES = {
  analysis: {
    sourceDigest: 'a2f16c585cb45488a31d73814207052632af13c0da622af8f7b93e5ed8d52c56',
    preparedDigest: '86fd8c04cbd3f3972a3b00afd45fa7d664851252460baffafd0f56358ec1c75e',
    sourceByteCount: 54,
    preparedByteCount: 2638,
    providerPayloadByteCount: 80,
    promptCacheShard: 9,
    limits: {
      sourceBytes: 16384,
      providerPayloadBytes: 16384,
      preparedRequestBytes: 65536,
      responseBytes: 131072,
      outputTokens: 1024,
      costMicros: 1684,
    },
    requestBindingKeyId: 'request-v1',
    requestBindingHmac: '2Bc4knZXmOW_tAKesDYNYDxwt7NTY2YuTv6Gpy0ZLXw',
    canonicalProviderBytesSha256:
      '19f0e449a3030a80afa32620b0c15362062e61032fd396bf34dc74b78aadb8dc',
    canonicalProviderByteLength: 2638,
  },
  reply: {
    sourceDigest: '916622962728c9a3a2ad6c2e44fc2e47e777d9420a0b13c66c8ae576a596d14d',
    preparedDigest: 'fbf251d887c38c25d42cc4a7723c76265b4b5050a17d9e71ee2f27a2cf53e94f',
    sourceByteCount: 86,
    preparedByteCount: 2710,
    providerPayloadByteCount: 216,
    promptCacheShard: 15,
    limits: {
      sourceBytes: 16384,
      providerPayloadBytes: 16384,
      preparedRequestBytes: 65536,
      responseBytes: 131072,
      outputTokens: 1024,
      costMicros: 1695,
    },
    requestBindingKeyId: 'request-v1',
    requestBindingHmac: 'UP2vxaB1FGWoFUMmhESUBxR8iGv7GoMzAoyB0XvNrZk',
    canonicalProviderBytesSha256:
      'e3dd149066502b4d8f87ddd0ee340c18db69459c057952988b4a08add8ac3721',
    canonicalProviderByteLength: 2710,
  },
  trend: {
    sourceDigest: 'c42fb3d5198ee5e97b829f07bcccfb36ab0b823de3538d2971b29397780289db',
    preparedDigest: '60d5d20fcd9616df679b8315d542ee8863e55e91ee32143ef95f0540b9d76550',
    sourceByteCount: 1456,
    preparedByteCount: 2964,
    providerPayloadByteCount: 1455,
    promptCacheShard: 0,
    limits: {
      sourceBytes: 65536,
      providerPayloadBytes: 65536,
      preparedRequestBytes: 131072,
      responseBytes: 131072,
      outputTokens: 2048,
      costMicros: 2942,
    },
    requestBindingKeyId: 'request-v1',
    requestBindingHmac: 'MyIKkm4NDtifABHXiKyXrEctNzfh0iWvVexsnTyEX5s',
    canonicalProviderBytesSha256:
      '54ab0232967ef9236fcb3ebab70954d490f532b1b538a08eef56dc11615edf3d',
    canonicalProviderByteLength: 2964,
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
  const base = analysisRequest()
  return parseAiGatewayRouteRequest({
    ...base,
    binding: { ...base.binding, languageCatalogueDigest: LANGUAGE_CATALOGUE_DIGEST },
  })
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

describe('OpenAI and the v2 profiles, as they were before the provider seam', () => {
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
