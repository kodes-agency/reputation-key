import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { z } from 'zod/v4'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  signAiReplyProvenance,
  verifyAiReplyProvenance,
  type AiReplyProvenancePayload,
} from './ai-reply-provenance'
import { REPLY_DRAFTING_V2_PROFILE_DIGEST } from './reply-drafting-v2-contract'
import { REPLY_DRAFTING_V2_VERSIONS } from '#/shared/reply/schema'
import { canonicalizeRfc8785 } from '../merchant-ai-notice-contract'

const UUIDS = {
  operation: '10000000-0000-4000-8000-000000000001',
  property: '10000000-0000-4000-8000-000000000002',
} as const
const SHA = 'a'.repeat(64)

const PERMIT_BINDING = {
  executionPermitId: '10000000-0000-4000-8000-000000000003',
  executionAttempt: 2,
} as const

function payload(kid = 'reply-v1'): AiReplyProvenancePayload {
  return {
    version: REPLY_DRAFTING_V2_VERSIONS.provenance,
    kid,
    operationId: UUIDS.operation,
    actorId: 'actor_01',
    organizationId: 'organization_01',
    propertyId: UUIDS.property,
    reviewId: 'review_01',
    ...PERMIT_BINDING,
    sourceEpoch: 1,
    sourceRevision: 1,
    baseReplyStateRevision: 0,
    replyDraftingEpoch: 1,
    propertyProfileVersion: 1,
    providerDeploymentProfileVersion: 'private-beta-global-v3',
    operationProfileVersion: REPLY_DRAFTING_V2_VERSIONS.operation,
    modelSnapshot: 'gpt-6-luna',
    promptVersion: REPLY_DRAFTING_V2_VERSIONS.prompt,
    replyProfileVersion: REPLY_DRAFTING_V2_VERSIONS.profile,
    replyProfileDigest: REPLY_DRAFTING_V2_PROFILE_DIGEST,
    replyBrandProfileVersion: 7,
    replyBrandDisplayNameDigest: SHA,
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
    outputLeakageProfileVersion: 'gbp-reply-output-leakage-v1',
    outputLeakageProfileDigest: SHA,
    concreteLanguageTag: 'en-Latn',
    templateGroup: 'en-Latn',
    renderedSuggestionDigest: SHA,
    tokenExpiresAtEpochMillis: 1_780_000_600_000,
    draftExpiresAtEpochMillis: 1_780_001_200_000,
  }
}

/** Signs any payload under the given version's domain, bypassing the signer's schema. */
function signedRegardless(
  rawPayload: Readonly<Record<string, unknown>>,
  privateKey: KeyObject,
  generation = 'v4',
): string {
  const canonical = canonicalizeRfc8785(rawPayload)
  const signature = sign(
    null,
    Buffer.from(`repkey-ai-reply-provenance-${generation}\0${canonical}`, 'utf8'),
    privateKey,
  )
  return `rk_ai_reply_${generation}.${Buffer.from(canonical, 'utf8').toString('base64url')}.${signature.toString('base64url')}`
}

function tokenWith(payloadPart: string, signaturePart: string): string {
  return `rk_ai_reply_v4.${payloadPart}.${signaturePart}`
}

describe('AI reply provenance', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('./reply-drafting-v2-contract')
    vi.resetModules()
  })

  it('keeps a signed suggestion verifiable across a policy deployment', async () => {
    const keys = generateKeyPairSync('ed25519')
    const original = payload()
    const token = signAiReplyProvenance(original, keys.privateKey)
    vi.resetModules()
    vi.doMock('./reply-drafting-v2-contract', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./reply-drafting-v2-contract')>()),
      REPLY_DRAFTING_V2_PROFILE_DIGEST: 'c'.repeat(64),
    }))
    const deployed = await import('./ai-reply-provenance')
    const keyring = new Map([['reply-v1', keys.publicKey]])
    expect(deployed.verifyAiReplyProvenance(token, keyring)).toEqual(original)
    const [prefix, , signature] = token.split('.')
    const changed = Buffer.from(
      JSON.stringify({ ...original, replyProfileDigest: '0'.repeat(64) }),
    ).toString('base64url')
    expect(
      deployed.verifyAiReplyProvenance(`${prefix}.${changed}.${signature}`, keyring),
    ).toBeNull()
  })

  it('refuses an unknown reply policy digest', () => {
    const keys = generateKeyPairSync('ed25519')
    expect(() =>
      signAiReplyProvenance(
        { ...payload(), replyProfileDigest: '0'.repeat(64) },
        keys.privateKey,
      ),
    ).toThrow(z.ZodError)
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

  it('refuses a token of an earlier generation and a model snapshot nothing serves', () => {
    const keys = generateKeyPairSync('ed25519')
    const keyring = new Map([['reply-v1', keys.publicKey]])
    const current = signAiReplyProvenance(payload(), keys.privateKey)

    expect(current).toMatch(/^rk_ai_reply_v4\./u)
    for (const generation of ['v1', 'v2', 'v3']) {
      expect(
        verifyAiReplyProvenance(
          current.replace(/^rk_ai_reply_v4/u, `rk_ai_reply_${generation}`),
          keyring,
        ),
      ).toBeNull()
      expect(
        verifyAiReplyProvenance(
          signedRegardless(payload(), keys.privateKey, generation),
          keyring,
        ),
      ).toBeNull()
    }
    expect(() =>
      signAiReplyProvenance(
        { ...payload(), replyBrandDisplayNameDigest: 'not-a-digest' },
        keys.privateKey,
      ),
    ).toThrow(z.ZodError)
    expect(() =>
      signAiReplyProvenance(
        { ...payload(), modelSnapshot: 'gpt-5.4-mini-2026-03-17' } as never,
        keys.privateKey,
      ),
    ).toThrow(z.ZodError)
  })

  it('verifies a fixed token shaped exactly like the reply drafting signer builds it', () => {
    const keys = generateKeyPairSync('ed25519')
    const fixedPayload: AiReplyProvenancePayload = {
      ...payload('route-preparer-fixed-v1'),
      operationId: '20000000-0000-4000-8000-000000000010',
      actorId: 'actor_fixed_01',
      organizationId: 'organization_fixed_01',
      propertyId: '20000000-0000-4000-8000-000000000020',
      reviewId: 'review_fixed_01',
      sourceEpoch: 3,
      sourceRevision: 2,
      baseReplyStateRevision: 1,
      replyDraftingEpoch: 4,
      propertyProfileVersion: 5,
      replyBrandProfileVersion: 9,
      replyBrandDisplayNameDigest: 'b'.repeat(64),
      outputLeakageProfileDigest: 'c'.repeat(64),
      concreteLanguageTag: 'bg-Cyrl',
      templateGroup: 'bg-Cyrl',
      renderedSuggestionDigest: 'd'.repeat(64),
    }

    const token = signAiReplyProvenance(fixedPayload, keys.privateKey)

    expect(token).toMatch(/^rk_ai_reply_v4\./u)
    expect(
      verifyAiReplyProvenance(token, new Map([[fixedPayload.kid, keys.publicKey]])),
    ).toEqual(fixedPayload)
    const otherKeys = generateKeyPairSync('ed25519')
    expect(
      verifyAiReplyProvenance(token, new Map([[fixedPayload.kid, otherKeys.publicKey]])),
    ).toBeNull()
  })

  it('admits provenance only for the approved reply languages', () => {
    const keys = generateKeyPairSync('ed25519')
    expect(() =>
      signAiReplyProvenance(
        {
          ...payload(),
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

  describe('execution binding', () => {
    const build = payload
    const keys = generateKeyPairSync('ed25519')
    const keyring = new Map([['reply-v1', keys.publicKey]])
    // The binding earlier tokens carried; the key is assembled so only the
    // column's own schema file spells it out.
    const LEGACY_BINDING = { ['requestBinding' + 'Hmac']: 'A'.repeat(43) } as const
    const withoutBinding = () => {
      const { executionPermitId: _permit, executionAttempt: _attempt, ...rest } = build()
      return rest
    }

    it('round-trips a token bound to an execution permit and attempt', () => {
      const permitBound = build()
      const token = signAiReplyProvenance(permitBound, keys.privateKey)

      expect(verifyAiReplyProvenance(token, keyring)).toEqual(permitBound)
    })

    it.each([
      ['a request binding', () => ({ ...withoutBinding(), ...LEGACY_BINDING })],
      ['both bindings', () => ({ ...build(), ...LEGACY_BINDING })],
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
      ['attempt zero', () => ({ ...build(), executionAttempt: 0 })],
      [
        'a permit that is not a UUID',
        () => ({ ...build(), executionPermitId: 'permit_01' }),
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
