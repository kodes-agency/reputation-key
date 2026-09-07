// The admission authority is the only caller of the budget ledger in
// production. What it adds on top: the operation must be the executing
// attempt the descriptor names, a replayed grant returns the nonce it minted
// (a different binding does not), and a settlement is priced from usage once.

import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { getPool } from '#/shared/db/pool'
import { aiOperations } from '#/shared/db/schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { settledCostMicros } from '#/shared/ai-openai-provider-profile'
import type {
  AiAdmissionDescriptorV1,
  AiSettlementRequestV1,
} from '#/shared/ai-internal-transport-contract'
import {
  AI_REPLY_OPERATION_PROFILE,
  installAiOperationFixture,
  type AiOperationFixture,
} from '#/shared/db/testing/ai-operation-fixture'
import { createPostgresAiAdmissionAuthority } from './postgres-admission-authority'

type PropertyDescriptor = Extract<AiAdmissionDescriptorV1, { subjectKind: 'property' }>

const NOW = new Date(Date.now() - 60_000)
const ORGANIZATION_ID = organizationId('ai-admission-test-org')
const PROPERTY_ID = propertyId('76000000-0000-4000-8000-000000000001')
const SIGNING_KID = 'grant-v1'
const SOURCE_DIGEST = 'd'.repeat(64)
const SOURCE_BYTES = 40
const BINDING = { keyId: 'binding-v1', hmac: 'A'.repeat(43) } as const

function descriptor(input: {
  operationId: string
  permitId: string
}): PropertyDescriptor {
  // The authority reads route, ids, attempt, permit, digest, byte count and
  // deadline; the rest is the wire shape the admission service validated.
  return {
    version: 'ai-admission-descriptor-v1',
    subjectKind: 'property',
    route: 'reply-suggestion',
    operationId: input.operationId,
    permitId: input.permitId,
    attemptNumber: 1,
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    internalSubjectId: 'subject-1',
    actorId: 'ai-admission-test-user',
    binding: {
      authorizationLineageId: '76000000-0000-4000-8000-000000000003',
      noticeVersion: 'merchant-ai-notice-v2',
      noticeDigest: 'b'.repeat(64),
      capabilityFence: {
        capability: 'reply_drafting',
        replyDraftingEpoch: 1,
        baseReplyStateRevision: 0,
      },
      sourceEpoch: 1,
      evaluatedLanguage: 'en',
      concreteReplyLanguage: null,
      languageCatalogueDigest: null,
      replyLanguageVerifierDigest: null,
      languageScriptConsistencyDigest: null,
      zhOrthographyVerifierDigest: null,
      sourceRevision: 1,
      reviewedAtEpochMillis: NOW.getTime(),
      propertyProfileVersion: 1,
      replyBrandProfileVersion: null,
      replyBrandDisplayNameDigest: null,
      routingPolicyVersion: 1,
      sourcePolicyId: 'google-business-profile-source-policy-v1',
      sourceCanonicalizerDigest: 'a'.repeat(64),
      redactionProfileVersion: 'gbp-review-global-v1',
      outputLeakageProfileVersion: 'ai-output-leakage-v1',
      outputLeakageProfileDigest: 'a'.repeat(64),
      replyTemplateCatalogueVersion: 'gbp-reply-template-catalogue-v1',
      replyTemplateCatalogueDigest: 'a'.repeat(64),
      aiSubjectHmacKeyVersion: null,
      stopFence: {
        globalControlId: '76000000-0000-4000-8000-000000000010',
        globalGeneration: 1,
        providerControlId: '76000000-0000-4000-8000-000000000011',
        providerGeneration: 1,
        capabilityControlId: '76000000-0000-4000-8000-000000000012',
        capabilityGeneration: 1,
      },
      providerDeploymentProfileVersion:
        AI_REPLY_OPERATION_PROFILE.providerDeploymentProfileVersion,
      operationProfileVersion: AI_REPLY_OPERATION_PROFILE.profileVersion,
      capabilityRuntimeProfileVersion:
        AI_REPLY_OPERATION_PROFILE.capabilityRuntimeProfileVersion,
    },
    canaryBinding: null,
    releaseSha: null,
    canaryAuthorizationId: null,
    sourceDigest: SOURCE_DIGEST,
    preparedDigest: 'c'.repeat(64),
    sourceByteCount: SOURCE_BYTES,
    preparedByteCount: 256,
    providerPayloadByteCount: 512,
    promptCacheShard: 0,
    limits: {
      sourceBytes: 1_024,
      providerPayloadBytes: 2_048,
      preparedRequestBytes: 4_096,
      responseBytes: 8_192,
      outputTokens: 64,
      costMicros: 100_000,
    },
    callerDeadlineEpochMillis: NOW.getTime() + 70_000,
    observedContentExpiresAtEpochMillis: NOW.getTime() + 24 * 60 * 60_000,
    redactionCountry: 'US',
    redactionProfileVersion: 'gbp-review-global-v1',
    outputLeakageProfileVersion: 'ai-output-leakage-v1',
    outputLeakageProfileDigest: 'a'.repeat(64),
    replyTemplateCatalogueVersion: 'gbp-reply-template-catalogue-v1',
    replyTemplateCatalogueDigest: 'a'.repeat(64),
  }
}

function settlement(
  input: { operationId: string; permitId: string; nonce: string },
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number },
): AiSettlementRequestV1 {
  return {
    operationId: input.operationId,
    permitId: input.permitId,
    attemptNumber: 1,
    nonce: input.nonce,
    disposition: 'success',
    reportedDisposition: 'success',
    providerRetryable: false,
    usageKnown: true,
    ...usage,
    reasoningTokens: 0,
    retryAfterSeconds: null,
  }
}

describe.sequential('AI admission authority (real PostgreSQL)', () => {
  const db = getDb()
  let fixture: AiOperationFixture
  const authority = createPostgresAiAdmissionAuthority({
    pool: getPool(),
    signingKid: SIGNING_KID,
    rateLimiter: { check: async () => ({ allowed: true }) },
    now: () => NOW,
  })

  beforeAll(async () => {
    fixture = await installAiOperationFixture({
      db,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      actorUserId: 'ai-admission-test-user',
      now: NOW,
    })
  })

  afterAll(async () => {
    await fixture.remove()
  })

  const executingOperation = async () => {
    const permitId = randomUUID()
    const operationId = await fixture.seedOperation({
      state: 'executing',
      executionAttempt: 1,
      executionPermitId: permitId,
      sourceDigest: SOURCE_DIGEST,
      sourceByteCount: SOURCE_BYTES,
    })
    return { operationId, permitId }
  }

  it('admits the executing attempt once and replays its nonce only for the same binding', async () => {
    const subject = await executingOperation()

    const granted = await authority.authorizeProperty(descriptor(subject), BINDING)
    expect(granted).toMatchObject({
      status: 'admitted',
      issuedAtEpochMillis: NOW.getTime(),
      expiresAtEpochMillis: NOW.getTime() + 70_000,
    })
    if (granted.status !== 'admitted') throw new Error('unreachable')
    expect(granted.nonce).not.toBe('')

    await expect(
      authority.authorizeProperty(descriptor(subject), BINDING),
    ).resolves.toMatchObject({
      status: 'admitted',
      nonce: granted.nonce,
    })
    await expect(
      authority.authorizeProperty(descriptor(subject), {
        ...BINDING,
        hmac: 'B'.repeat(43),
      }),
    ).resolves.toEqual({ status: 'denied', code: 'already_consumed' })
    await expect(
      authority.authorizeProperty(
        { ...descriptor(subject), permitId: randomUUID() },
        BINDING,
      ),
    ).resolves.toEqual({ status: 'denied', code: 'subject_mismatch' })
    await expect(
      db
        .select({
          grantKid: aiOperations.grantKid,
          reservedMicros: aiOperations.reservedMicros,
        })
        .from(aiOperations)
        .where(eq(aiOperations.id, subject.operationId)),
    ).resolves.toEqual([{ grantKid: SIGNING_KID, reservedMicros: expect.any(Number) }])
  })

  it('refuses an operation that is not executing', async () => {
    const permitId = randomUUID()
    const operationId = await fixture.seedOperation({
      state: 'pending',
      executionAttempt: 1,
      executionPermitId: permitId,
      sourceDigest: SOURCE_DIGEST,
      sourceByteCount: SOURCE_BYTES,
    })
    await expect(
      authority.authorizeProperty(descriptor({ operationId, permitId }), BINDING),
    ).resolves.toEqual({ status: 'denied', code: 'subject_mismatch' })
  })

  it('settles a granted operation from usage once and refuses a different cost afterwards', async () => {
    const subject = await executingOperation()
    const granted = await authority.authorizeProperty(descriptor(subject), BINDING)
    if (granted.status !== 'admitted') throw new Error(`not admitted: ${granted.code}`)
    const usage = { inputTokens: 1_000, cachedInputTokens: 200, outputTokens: 300 }
    const cost = Number(settledCostMicros(usage))

    const settled = await authority.settle(
      settlement({ ...subject, nonce: granted.nonce }, usage),
      SIGNING_KID,
    )
    expect(settled).toMatchObject({
      status: 'settled',
      costMicros: cost,
      settlementState: 'settled',
      grantKid: SIGNING_KID,
      requestBindingHmac: BINDING.hmac,
    })
    await expect(
      authority.settle(
        settlement({ ...subject, nonce: granted.nonce }, usage),
        SIGNING_KID,
      ),
    ).resolves.toMatchObject({ status: 'settled', costMicros: cost })
    await expect(
      authority.settle(
        settlement({ ...subject, nonce: granted.nonce }, { ...usage, outputTokens: 301 }),
        SIGNING_KID,
      ),
    ).resolves.toEqual({ status: 'denied', code: 'settlement_conflict' })
    await expect(
      authority.settle(
        settlement({ ...subject, nonce: 'someone-elses-nonce' }, usage),
        SIGNING_KID,
      ),
    ).resolves.toEqual({ status: 'denied', code: 'permit_mismatch' })
    await expect(
      authority.settle(
        settlement({ ...subject, nonce: granted.nonce }, usage),
        'grant-v2',
      ),
    ).rejects.toThrow(/key ID/)
  })
})
