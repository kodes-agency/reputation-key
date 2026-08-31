import { generateKeyPairSync } from 'node:crypto'
import { z } from 'zod/v4'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  signAiReplyProvenance,
  verifyAiReplyProvenance,
  type AiReplyProvenancePayloadV1,
  type AiReplyProvenancePayloadV2,
  type AiReplyProvenancePayloadV3,
} from './provenance'
import {
  AI_PERSONALIZED_REPLY_PROFILE_DIGEST,
  AI_PERSONALIZED_REPLY_PROFILE_VERSION,
} from '../../src/shared/ai-personalized-reply-contract'

const UUIDS = {
  operation: '10000000-0000-4000-8000-000000000001',
  property: '10000000-0000-4000-8000-000000000002',
} as const
const SHA = 'a'.repeat(64)
const LEGACY_PERSONALIZED_REPLY_PROFILE_DIGEST =
  '86bb98cb3b0b1c8561141e2ec30e019725d5f0ba5dd57be4745c7db5bc851769'

function commonPayload(kid: string) {
  return {
    kid,
    operationId: UUIDS.operation,
    actorId: 'actor_01',
    organizationId: 'organization_01',
    propertyId: UUIDS.property,
    reviewId: 'review_01',
    requestBindingHmac: 'A'.repeat(43),
    sourceEpoch: 1,
    sourceRevision: 1,
    baseReplyStateRevision: 0,
    replyDraftingEpoch: 1,
    propertyProfileVersion: 1,
    providerDeploymentProfileVersion: 'private-beta-global-v1',
    operationProfileVersion: 'reply-suggestion-v1',
    modelSnapshot: 'gpt-5.4-mini-2026-03-17',
    promptVersion: 'reply-suggestion-prompt-v1',
    outputLeakageProfileVersion: 'gbp-reply-output-leakage-v1',
    outputLeakageProfileDigest: SHA,
    concreteLanguageTag: 'en-Latn',
    templateGroup: 'en-Latn',
    renderedSuggestionDigest: SHA,
    tokenExpiresAtEpochMillis: 1_780_000_600_000,
    draftExpiresAtEpochMillis: 1_780_001_200_000,
  } as const
}

function payload(kid = 'reply-v1'): AiReplyProvenancePayloadV1 {
  return {
    ...commonPayload(kid),
    version: 'ai-reply-provenance-v1',
    replyTemplateCatalogueVersion: 'gbp-reply-template-catalogue-v1',
    replyTemplateCatalogueDigest: SHA,
    templateId: 'appreciation_positive',
  }
}

function personalizedPayload(kid = 'reply-v1'): AiReplyProvenancePayloadV2 {
  return {
    ...commonPayload(kid),
    version: 'ai-reply-provenance-v2',
    replyProfileVersion: 'reply-draft-v1',
    replyProfileDigest: LEGACY_PERSONALIZED_REPLY_PROFILE_DIGEST,
  }
}

function groundedPersonalizedPayload(kid = 'reply-v1'): AiReplyProvenancePayloadV3 {
  return {
    ...commonPayload(kid),
    version: 'ai-reply-provenance-v3',
    replyProfileVersion: AI_PERSONALIZED_REPLY_PROFILE_VERSION,
    replyProfileDigest: AI_PERSONALIZED_REPLY_PROFILE_DIGEST,
    replyBrandProfileVersion: 7,
    replyBrandDisplayNameDigest: SHA,
  }
}

function tokenWith(payloadPart: string, signaturePart: string): string {
  return `rk_ai_reply_v1.${payloadPart}.${signaturePart}`
}

describe('AI reply provenance', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('round-trips one canonical token and zeroes signer-owned buffers', () => {
    const keys = generateKeyPairSync('ed25519')
    const fill = vi.spyOn(Buffer.prototype, 'fill')
    const token = signAiReplyProvenance(payload(), keys.privateKey)

    expect(
      verifyAiReplyProvenance(token, new Map([['reply-v1', keys.publicKey]])),
    ).toEqual(payload())
    const zeroed = fill.mock.instances.filter(Buffer.isBuffer)
    expect(zeroed.length).toBeGreaterThanOrEqual(3)
    expect(zeroed.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true)
  })

  it('round-trips personalized provenance under a distinct domain and rejects cross-version aliases', () => {
    const keys = generateKeyPairSync('ed25519')
    const token = signAiReplyProvenance(personalizedPayload(), keys.privateKey)
    const keyring = new Map([['reply-v1', keys.publicKey]])

    expect(token).toMatch(/^rk_ai_reply_v2\./u)
    expect(verifyAiReplyProvenance(token, keyring)).toEqual(personalizedPayload())
    expect(
      verifyAiReplyProvenance(
        token.replace(/^rk_ai_reply_v2/u, 'rk_ai_reply_v1'),
        keyring,
      ),
    ).toBeNull()
  })

  it('round-trips grounded personalized provenance and binds the exact public profile fact', () => {
    const keys = generateKeyPairSync('ed25519')
    const token = signAiReplyProvenance(groundedPersonalizedPayload(), keys.privateKey)
    const keyring = new Map([['reply-v1', keys.publicKey]])

    expect(token).toMatch(/^rk_ai_reply_v3\./u)
    expect(verifyAiReplyProvenance(token, keyring)).toEqual(groundedPersonalizedPayload())
    expect(
      verifyAiReplyProvenance(
        token.replace(/^rk_ai_reply_v3/u, 'rk_ai_reply_v2'),
        keyring,
      ),
    ).toBeNull()
    expect(() =>
      signAiReplyProvenance(
        {
          ...groundedPersonalizedPayload(),
          replyBrandDisplayNameDigest: 'not-a-digest',
        },
        keys.privateKey,
      ),
    ).toThrow(z.ZodError)
  })

  it('admits personalized provenance only for the approved English and Bulgarian profiles', () => {
    const keys = generateKeyPairSync('ed25519')
    expect(() =>
      signAiReplyProvenance(
        {
          ...groundedPersonalizedPayload(),
          concreteLanguageTag: 'tr-Latn',
          templateGroup: 'tr-Latn',
        },
        keys.privateKey,
      ),
    ).toThrow(z.ZodError)
  })

  it.each([
    (token: string) => `${token}=`,
    (token: string) => token.replace(/\.([A-Za-z0-9_-]+)$/, '.$1='),
    (token: string) =>
      token.replace(
        /\.([A-Za-z0-9_-]+)$/,
        (_match, signature) => `.${signature.slice(0, -1)}+`,
      ),
  ])('rejects noncanonical base64url token aliases', (mutate) => {
    const keys = generateKeyPairSync('ed25519')
    const token = signAiReplyProvenance(payload(), keys.privateKey)
    expect(
      verifyAiReplyProvenance(mutate(token), new Map([['reply-v1', keys.publicKey]])),
    ).toBeNull()
  })

  it('zeroes decoded payload and signature buffers on every post-decode failure', () => {
    const keys = generateKeyPairSync('ed25519')
    const valid = signAiReplyProvenance(payload(), keys.privateKey)
    const [, validPayload, validSignature] = valid.split('.') as [string, string, string]
    const mismatchedPayload = Buffer.from(
      JSON.stringify({ ...payload(), actorId: 'other_actor' }),
      'utf8',
    ).toString('base64url')
    const malformedPayload = Buffer.from('{', 'utf8').toString('base64url')
    const missingKidPayload = Buffer.from(
      JSON.stringify(payload('missing-v1')),
      'utf8',
    ).toString('base64url')
    const failures = [
      tokenWith(validPayload, Buffer.alloc(63).toString('base64url')),
      tokenWith(mismatchedPayload, validSignature),
      tokenWith(missingKidPayload, validSignature),
      tokenWith(malformedPayload, validSignature),
    ]

    for (const candidate of failures) {
      const fill = vi.spyOn(Buffer.prototype, 'fill')
      expect(
        verifyAiReplyProvenance(candidate, new Map([['reply-v1', keys.publicKey]])),
      ).toBeNull()
      const zeroed = fill.mock.instances.filter(Buffer.isBuffer)
      expect(zeroed.length).toBeGreaterThanOrEqual(2)
      expect(zeroed.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true)
      fill.mockRestore()
    }
  })

  it('rejects control scalars and every unpaired-surrogate position in bound IDs', () => {
    const keys = generateKeyPairSync('ed25519')
    for (const actorId of ['actor\u0000id', '\uD800', 'before\uD800after', '\uDC00']) {
      let thrown: unknown
      try {
        signAiReplyProvenance({ ...payload(), actorId }, keys.privateKey)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(z.ZodError)
      expect((thrown as z.ZodError).issues.map((issue) => issue.path.join('.'))).toEqual([
        'actorId',
      ])
    }
  })
})
