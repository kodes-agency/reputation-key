import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { z } from 'zod/v4'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  signAiReplyProvenance,
  verifyAiReplyProvenance,
  type AiReplyProvenancePayload,
  type AiReplyProvenancePayloadV1,
  type AiReplyProvenancePayloadV2,
  type AiReplyProvenancePayloadV3,
} from './ai-reply-provenance'
import {
  AI_PERSONALIZED_REPLY_PROFILE_DIGEST,
  AI_PERSONALIZED_REPLY_PROFILE_VERSION,
} from '#/shared/ai-personalized-reply-contract'
import { REPLY_DRAFTING_V2_PROFILE_DIGEST } from './reply-drafting-v2-contract'
import { REPLY_DRAFTING_V2_VERSIONS } from './reply-drafting-v2-schema'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'

const UUIDS = {
  operation: '10000000-0000-4000-8000-000000000001',
  property: '10000000-0000-4000-8000-000000000002',
} as const
const SHA = 'a'.repeat(64)
const LEGACY_PERSONALIZED_REPLY_PROFILE_DIGEST =
  '86bb98cb3b0b1c8561141e2ec30e019725d5f0ba5dd57be4745c7db5bc851769'
const PRIOR_GROUNDED_PROFILE_DIGEST =
  '5949290a4d71a8cb5466596f066040ccc7194e8b2327ba361cf21e0152df45f2'
const PRIOR_SENTENCE_PROFILE_DIGEST =
  '41c1bdf74408dd526d2b29983e3e0c371d818a548575b46e3df2c78024884658'

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

const PERMIT_BINDING = {
  executionPermitId: '10000000-0000-4000-8000-000000000003',
  executionAttempt: 2,
} as const

/** Signs any payload under its version's domain, bypassing the signer's schema. */
function signedRegardless(
  rawPayload: Readonly<Record<string, unknown> & { version: string }>,
  privateKey: KeyObject,
): string {
  const versionNumber = rawPayload.version.slice('ai-reply-provenance-'.length)
  const canonical = canonicalizeRfc8785(rawPayload)
  const signature = sign(
    null,
    Buffer.from(`repkey-${rawPayload.version}\0${canonical}`, 'utf8'),
    privateKey,
  )
  return `rk_ai_reply_${versionNumber}.${Buffer.from(canonical, 'utf8').toString('base64url')}.${signature.toString('base64url')}`
}

function tokenWith(payloadPart: string, signaturePart: string): string {
  return `rk_ai_reply_v1.${payloadPart}.${signaturePart}`
}

function sentencePayload(): Extract<
  AiReplyProvenancePayload,
  { version: 'ai-reply-provenance-v4' }
> {
  return {
    ...groundedPersonalizedPayload(),
    version: REPLY_DRAFTING_V2_VERSIONS.provenance,
    operationProfileVersion: REPLY_DRAFTING_V2_VERSIONS.operation,
    promptVersion: REPLY_DRAFTING_V2_VERSIONS.prompt,
    replyProfileVersion: REPLY_DRAFTING_V2_VERSIONS.profile,
    replyProfileDigest: REPLY_DRAFTING_V2_PROFILE_DIGEST,
    replyVoiceDigest: SHA,
    voiceChoices: {
      closing: 0,
      signOff: 0,
      contactSentence: 0,
      emoji: 0,
      includeContact: false,
    },
    parentOperationId: null,
    rewriteOrdinal: 0,
  }
}

describe('AI reply provenance', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('./ai-personalized-reply-contract')
    vi.doUnmock('./reply-drafting-v2-contract')
    vi.resetModules()
  })

  it.each([
    ['grounded', groundedPersonalizedPayload, PRIOR_GROUNDED_PROFILE_DIGEST],
    ['sentence', sentencePayload, PRIOR_SENTENCE_PROFILE_DIGEST],
    [
      'prior grounded',
      () => ({
        ...groundedPersonalizedPayload(),
        replyProfileDigest: PRIOR_GROUNDED_PROFILE_DIGEST,
      }),
      AI_PERSONALIZED_REPLY_PROFILE_DIGEST,
    ],
    [
      'prior sentence',
      () => ({
        ...sentencePayload(),
        replyProfileDigest: PRIOR_SENTENCE_PROFILE_DIGEST,
      }),
      REPLY_DRAFTING_V2_PROFILE_DIGEST,
    ],
  ] as const)(
    'keeps a signed %s suggestion verifiable across a policy deployment',
    async (_name, makePayload, otherSupportedDigest) => {
      const keys = generateKeyPairSync('ed25519')
      const original = makePayload()
      const token = signAiReplyProvenance(original, keys.privateKey)
      vi.resetModules()
      vi.doMock('./ai-personalized-reply-contract', async (importOriginal) => ({
        ...(await importOriginal<typeof import('./ai-personalized-reply-contract')>()),
        AI_PERSONALIZED_REPLY_PROFILE_DIGEST: 'b'.repeat(64),
      }))
      vi.doMock('./reply-drafting-v2-contract', async (importOriginal) => ({
        ...(await importOriginal<typeof import('./reply-drafting-v2-contract')>()),
        REPLY_DRAFTING_V2_PROFILE_DIGEST: 'c'.repeat(64),
      }))
      const deployed = await import('./ai-reply-provenance')
      const keyring = new Map([['reply-v1', keys.publicKey]])
      expect(deployed.verifyAiReplyProvenance(token, keyring)).toEqual(original)
      const [prefix, , signature] = token.split('.')
      const changed = Buffer.from(
        JSON.stringify({ ...original, replyProfileDigest: otherSupportedDigest }),
      ).toString('base64url')
      expect(
        deployed.verifyAiReplyProvenance(`${prefix}.${changed}.${signature}`, keyring),
      ).toBeNull()
    },
  )

  it.each([groundedPersonalizedPayload, sentencePayload])(
    'refuses an unknown reply policy digest',
    (makePayload) => {
      const keys = generateKeyPairSync('ed25519')
      expect(() =>
        signAiReplyProvenance(
          { ...makePayload(), replyProfileDigest: '0'.repeat(64) },
          keys.privateKey,
        ),
      ).toThrow(z.ZodError)
    },
  )

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

  it('verifies a fixed V3 token shaped exactly like route-preparer.ts signs, from the same module', () => {
    // Before the ai-provider-control/provenance.ts <-> ai-reply-provenance.ts
    // merge, src/shared/ai-provider-control/route-preparer.ts (the only
    // production signer) called the OTHER copy of signAiReplyProvenance, and
    // this suite only ever exercised the copy nothing in production called.
    // This test pins the exact field set and digests route-preparer.ts's
    // reply-suggestion handler builds, so a change to either function is
    // proven compatible with the real production payload shape, signed and
    // verified through the one module both now share.
    const keys = generateKeyPairSync('ed25519')
    const fixedPayload: AiReplyProvenancePayloadV3 = {
      version: 'ai-reply-provenance-v3',
      kid: 'route-preparer-fixed-v1',
      operationId: '20000000-0000-4000-8000-000000000010',
      actorId: 'actor_fixed_01',
      organizationId: 'organization_fixed_01',
      propertyId: '20000000-0000-4000-8000-000000000020',
      reviewId: 'review_fixed_01',
      requestBindingHmac: 'B'.repeat(43),
      sourceEpoch: 3,
      sourceRevision: 2,
      baseReplyStateRevision: 1,
      replyDraftingEpoch: 4,
      propertyProfileVersion: 5,
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      operationProfileVersion: 'reply-suggestion-v1',
      replyProfileVersion: AI_PERSONALIZED_REPLY_PROFILE_VERSION,
      replyProfileDigest: AI_PERSONALIZED_REPLY_PROFILE_DIGEST,
      replyBrandProfileVersion: 9,
      replyBrandDisplayNameDigest: 'b'.repeat(64),
      modelSnapshot: 'gpt-5.4-mini-2026-03-17',
      promptVersion: 'reply-suggestion-prompt-v1',
      outputLeakageProfileVersion: 'gbp-reply-output-leakage-v1',
      outputLeakageProfileDigest: 'c'.repeat(64),
      concreteLanguageTag: 'bg-Cyrl',
      templateGroup: 'bg-Cyrl',
      renderedSuggestionDigest: 'd'.repeat(64),
      tokenExpiresAtEpochMillis: 1_780_000_600_000,
      draftExpiresAtEpochMillis: 1_780_001_200_000,
    }

    const token = signAiReplyProvenance(fixedPayload, keys.privateKey)

    expect(token).toMatch(/^rk_ai_reply_v3\./u)
    expect(
      verifyAiReplyProvenance(token, new Map([[fixedPayload.kid, keys.publicKey]])),
    ).toEqual(fixedPayload)
    const otherKeys = generateKeyPairSync('ed25519')
    expect(
      verifyAiReplyProvenance(token, new Map([[fixedPayload.kid, otherKeys.publicKey]])),
    ).toBeNull()
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

  describe.each([
    ['v1', payload],
    ['v2', personalizedPayload],
    ['v3', groundedPersonalizedPayload],
    ['v4', sentencePayload],
  ] as const)('%s execution binding', (_version, build) => {
    const keys = generateKeyPairSync('ed25519')
    const keyring = new Map([['reply-v1', keys.publicKey]])
    const withoutBinding = () => {
      const { requestBindingHmac: _requestBinding, ...rest } = build() as ReturnType<
        typeof build
      > & { requestBindingHmac: string }
      return rest
    }

    it('round-trips a token bound to an execution permit and attempt', () => {
      const permitBound = { ...withoutBinding(), ...PERMIT_BINDING }
      const token = signAiReplyProvenance(permitBound, keys.privateKey)

      expect(verifyAiReplyProvenance(token, keyring)).toEqual(permitBound)
    })

    it('keeps the legacy request-binding token bytes unchanged', () => {
      const legacy = build()
      const token = signAiReplyProvenance(legacy, keys.privateKey)

      expect(token).toBe(signedRegardless(legacy, keys.privateKey))
      expect(verifyAiReplyProvenance(token, keyring)).toEqual(legacy)
    })

    it.each([
      ['both bindings', () => ({ ...build(), ...PERMIT_BINDING })],
      ['no binding', withoutBinding],
      [
        'a permit without its attempt',
        () => ({
          ...withoutBinding(),
          executionPermitId: PERMIT_BINDING.executionPermitId,
        }),
      ],
      [
        'an attempt without its permit',
        () => ({
          ...withoutBinding(),
          executionAttempt: PERMIT_BINDING.executionAttempt,
        }),
      ],
      [
        'a request binding with an attempt',
        () => ({
          ...build(),
          executionAttempt: PERMIT_BINDING.executionAttempt,
        }),
      ],
      [
        'attempt zero',
        () => ({ ...withoutBinding(), ...PERMIT_BINDING, executionAttempt: 0 }),
      ],
      [
        'a permit that is not a UUID',
        () => ({
          ...withoutBinding(),
          ...PERMIT_BINDING,
          executionPermitId: 'permit_01',
        }),
      ],
    ])('refuses to sign or verify a token with %s', (_label, shape) => {
      const invalid = shape()

      expect(() =>
        signAiReplyProvenance(invalid as AiReplyProvenancePayload, keys.privateKey),
      ).toThrow(z.ZodError)
      expect(
        verifyAiReplyProvenance(signedRegardless(invalid, keys.privateKey), keyring),
      ).toBeNull()
    })
  })
})
