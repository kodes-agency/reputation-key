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
// For reply the body differs from the earlier one by the model name alone
// (two bytes shorter); their sources, payloads, shards and limits other than the price
// are the earlier ones. A change that moves any of these is a change to a live contract
// and must say so by editing this file in the same commit, with its reason.
//
// 2026-11-01: `reply-suggestion-v2` moved its profile and attestation digests, and
// nothing it sends. Its acceptance contract now normalizes the body before the output
// checks (`normalizeReplyDraftingV2Body`), because the provider's semicolons were
// refused as private data; its prompt, schema and request shape are unchanged.
//
// 2026-11-05: every profile that attests the redaction rules (review analysis v2 and v3,
// reply v1 and v2) moved its profile and attestation digests, and the reply request
// moved its request binding, because the structured marker detector profile now records
// the whole address policy and its Bulgarian name particles, and reads a link with
// credentials or an IP host as one URL. The bytes each pinned request sends are unchanged.
//
// 2026-11-01, later: `reply-suggestion-v2` moved its prompt, attestation, profile and static
// token digests. The owner rejected drafts that state what the guest reports as fact and
// lecture about how it should have been, so the prompt and the examples now apologize for how
// the visit went and promise only to check (ADR 0073, amended). The output ceiling went to
// 4,096 because reasoning could use all of 2,048 and return no reply. Its output schema and
// request shape are unchanged, and no consent or epoch moved (ADR 0074).

import { createHash, generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AI_OPERATION_PROFILES,
  AI_PROVIDER_DEPLOYMENT_PROFILE,
  AI_ROUTING_POLICY,
  OPENAI_REQUEST_SHAPE_V1_DIGEST,
} from '#/shared/ai-operation-profiles'
import { OPENAI_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1 } from '#/shared/ai-openai-provider-profile'
import {
  parseAiGatewayRouteRequest,
  type AiGatewayRouteRequestV1,
} from '#/shared/ai-gateway-transport-contract'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import {
  AI_REVIEW_LANGUAGE_REGION_ICU_VERSION,
  AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
  AI_REVIEW_LANGUAGE_REGION_UNICODE_VERSION,
} from '#/shared/generated/ai-review-language-canonical-regions-v1'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import { createAiGatewayRoutePreparer } from './route-preparer'
import { preparableV3Request } from './review-evidence.test-fixtures'

const PINNED_PROFILES = [
  {
    profileVersion: 'review-analysis-v3',
    profileDigest: 'd25c3e071e309060f7d7fafa7b65d95c54d1e0cf98841b8dc9449f5e3414b943',
    outputSchemaDigest:
      '8c72e79976c6b784c679f671b798c41b71e78795542c7d80571e48cebde40154',
    promptDigest: 'c912005966c45c7533a7fc9ba37f5b0fc70e7399a0555da360ce9fadab0cd1f3',
    artifactAttestationsDigest:
      '4b381099fb1bfc3b3b743b8f8f664b3fd42aed6b2aa404e1f1625c64499e9a22',
    sdkRequestShapeDigest:
      '0bf52569683db47a551f212b33a8e19dfdd768f0a70047740b5f57a72c11ce37',
    staticTokenBearingBytes: 15920,
    staticTokenBearingDigest:
      'ddff7f36f771ef47aa3388620ba8bf6ffa96a81619749e11db62f38b01c00afc',
  },
  // Reply v2 attests streaming and deployment v3.
  {
    profileVersion: 'reply-suggestion-v2',
    profileDigest: '96cc3926f0e9d0110b15e05be0233ff50270699ccee833caac0b4480c9b27642',
    outputSchemaDigest:
      '2f7afcc12b767302d60d6b1f931fd7996d010dd7c24ba32246fff415c1d4dcd7',
    promptDigest: '9c7c78dfc1e63b32e5916ecaceb33fca5eb0dd28a485066535df3772eb1dc805',
    artifactAttestationsDigest:
      '6ea0f5e0fa58086f16cbf8e69e85cc64cd2a9494c638fa2eb843e7200ffffa0a',
    sdkRequestShapeDigest:
      'f67f33645f1a50218dc369daa627337738b540db44840f9faf11bc403034f9f0',
    staticTokenBearingBytes: 14764,
    staticTokenBearingDigest:
      'bcfb513a7965dd991081ed779eef7fd5ebfb7b9df65aea277f39f282b61ca1ab',
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
] as const

const PINNED_PROVIDER_LEVEL = {
  deploymentProfileDigest:
    '07a1b133ea2c519ed61fc18ca376cc7e4494b48bbf738d5705739293722962b3',
  routingPolicyDigest: 'dce9ee5026db127ea4405639caa35e650aa8c6f29632220b1347f4f381e366ca',
  requestShapeDigest: '0bf52569683db47a551f212b33a8e19dfdd768f0a70047740b5f57a72c11ce37',
  normalizedClaimsDigest:
    '33aebd2c6985580b83ea6ccab6b3f0157bc1a17cc3e186eae3c076bfe09ac9ef',
} as const

// Keep these request inputs fixed: a later compatible notice must not change
// the byte-for-byte evidence for work admitted under this notice.
const PINNED_NOTICE = {
  noticeVersion: 'merchant-ai-notice-2026-11-06.v1',
  noticeDigest: 'eb810fedbb445bf9361d03280cfa44f31c3a8a8563a905549c3a7bdaed1a88f3',
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
    requestBindingHmac: 'f_P7JXjgZNBOi4ouCCpzZEAdGcB1As30gLf1f2t1-dM',
    canonicalProviderBytesSha256:
      'b6f063d3da8527243da1bb8ade4597edb704afb8031fb7d162f207ae558c6dc4',
    canonicalProviderByteLength: 18090,
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
  const base = preparableV3Request()
  return parseAiGatewayRouteRequest({
    ...base,
    binding: { ...base.binding, ...PINNED_NOTICE },
  })
}

function underServedNotice(request: AiGatewayRouteRequestV1) {
  return parseAiGatewayRouteRequest({
    ...request,
    binding: {
      ...request.binding,
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
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
    ['analysis', liveAnalysis, PINNED_ROUTES.analysis],
    [
      'analysis under the served notice',
      () => underServedNotice(liveAnalysis()),
      {
        ...PINNED_ROUTES.analysis,
        requestBindingHmac: '9YRKMfqP3-xz3wd4YJsTDzBjejuJphQ-jpaI3fI9bR8',
      },
    ],
  ] as const)(
    'sends OpenAI byte for byte the %s body, under the same descriptor, limits and request binding',
    (_route, request, pinned) => {
      const { invocation } = preparer().prepare(request())
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
