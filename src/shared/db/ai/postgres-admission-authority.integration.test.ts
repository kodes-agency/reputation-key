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
import { AI_REPLY_ADOPTION_WINDOW_MILLIS } from '#/shared/ai-reply-provenance'

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
  attemptNumber?: number
}): PropertyDescriptor {
  // The authority reads route, ids, attempt, permit, digest, byte count and
  // deadline; the rest is the wire shape the admission service validated.
  return {
    version: 'ai-admission-descriptor-v1',
    subjectKind: 'property',
    route: 'reply-suggestion',
    operationId: input.operationId,
    permitId: input.permitId,
    attemptNumber: input.attemptNumber ?? 1,
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
  input: { operationId: string; permitId: string; nonce: string; attemptNumber?: number },
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number },
): AiSettlementRequestV1 {
  return {
    operationId: input.operationId,
    permitId: input.permitId,
    attemptNumber: input.attemptNumber ?? 1,
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

/** What the gateway settles when it withheld dispatch (e.g. the grant TTL was too short). */
function noDispatch(input: {
  operationId: string
  permitId: string
  nonce: string
}): AiSettlementRequestV1 {
  return {
    operationId: input.operationId,
    permitId: input.permitId,
    attemptNumber: 1,
    nonce: input.nonce,
    disposition: 'no_dispatch',
    reportedDisposition: 'no_dispatch',
    providerRetryable: false,
    usageKnown: false,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
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

  // Reproduced live: the browser could not adopt a suggestion it had held for
  // 100 seconds, because the signed adoption token expired with the provider
  // *request* deadline (`callerDeadlineEpochMillis`, 70 s, most of it spent on
  // inference). The reading window is a human one and must outlive the call.
  it('issues a reply adoption window that outlives the provider request deadline', async () => {
    const subject = await executingOperation()

    const granted = await authority.authorizeProperty(descriptor(subject), BINDING)
    if (granted.status !== 'admitted') throw new Error(`not admitted: ${granted.code}`)

    expect(granted.expiresAtEpochMillis).toBe(NOW.getTime() + 70_000)
    expect(granted.replyTokenExpiresAtEpochMillis).toBe(
      NOW.getTime() + AI_REPLY_ADOPTION_WINDOW_MILLIS,
    )
    expect(granted.replyDraftExpiresAtEpochMillis).toBe(
      granted.replyTokenExpiresAtEpochMillis,
    )
  })

  // The accepting transaction also refuses an operation past its own
  // `expires_at`, so the window may never promise adoption time the operation
  // row cannot honour.
  it('never issues an adoption window past the operation row expiry', async () => {
    const permitId = randomUUID()
    const operationId = await fixture.seedOperation({
      state: 'executing',
      executionAttempt: 1,
      executionPermitId: permitId,
      sourceDigest: SOURCE_DIGEST,
      sourceByteCount: SOURCE_BYTES,
      expiresAt: new Date(NOW.getTime() + 90_000),
    })

    const granted = await authority.authorizeProperty(
      descriptor({ operationId, permitId }),
      BINDING,
    )
    if (granted.status !== 'admitted') throw new Error(`not admitted: ${granted.code}`)

    expect(granted.replyTokenExpiresAtEpochMillis).toBe(NOW.getTime() + 90_000)
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

  /** What `claimExecution` does between attempts: a new attempt, a new permit. */
  const claimNextAttempt = async (operationId: string, attemptNumber: number) => {
    const permitId = randomUUID()
    await db
      .update(aiOperations)
      .set({
        state: 'executing',
        executionAttempt: attemptNumber,
        executionPermitId: permitId,
      })
      .where(eq(aiOperations.id, operationId))
    return { operationId, permitId, attemptNumber }
  }

  // Reproduced on the closed beta (2026-09-29): during an import burst, database
  // waits left three analyses less grant time than the provider call needs, so
  // the gateway withheld dispatch and released the grant. Every later attempt
  // was then refused as `already_consumed`, the caller read that as an
  // ambiguous provider outcome, and after four attempts the reviews were
  // settled without an analysis. Nothing had been spent.
  it('admits the next attempt once the previous admission was released without dispatch', async () => {
    const first = await executingOperation()
    const granted = await authority.authorizeProperty(descriptor(first), BINDING)
    if (granted.status !== 'admitted') throw new Error(`not admitted: ${granted.code}`)
    await expect(
      authority.settle(noDispatch({ ...first, nonce: granted.nonce }), SIGNING_KID),
    ).resolves.toMatchObject({
      status: 'settled',
      costMicros: 0,
      settlementState: 'released',
    })

    const second = await claimNextAttempt(first.operationId, 2)
    const secondBinding = { ...BINDING, hmac: 'C'.repeat(43) }
    const regranted = await authority.authorizeProperty(descriptor(second), secondBinding)

    expect(regranted).toMatchObject({ status: 'admitted' })
    if (regranted.status !== 'admitted') throw new Error('unreachable')
    expect(regranted.nonce).not.toBe(granted.nonce)
    const [row] = await db
      .select({
        requestBindingHmac: aiOperations.requestBindingHmac,
        reservedMicros: aiOperations.reservedMicros,
        budgetSettledAt: aiOperations.budgetSettledAt,
        actualMicros: aiOperations.actualMicros,
      })
      .from(aiOperations)
      .where(eq(aiOperations.id, first.operationId))
    expect(row).toEqual({
      requestBindingHmac: secondBinding.hmac,
      reservedMicros: expect.any(Number),
      budgetSettledAt: null,
      actualMicros: null,
    })
    expect(row?.reservedMicros).toBeGreaterThan(0)

    // The fresh admission is settled from its own usage, once.
    const usage = { inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 100 }
    await expect(
      authority.settle(
        settlement({ ...second, nonce: regranted.nonce }, usage),
        SIGNING_KID,
      ),
    ).resolves.toMatchObject({
      status: 'settled',
      costMicros: Number(settledCostMicros(usage)),
      settlementState: 'settled',
    })
    // The released first attempt can no longer settle against the operation.
    await expect(
      authority.settle(noDispatch({ ...first, nonce: granted.nonce }), SIGNING_KID),
    ).resolves.toEqual({ status: 'denied', code: 'permit_mismatch' })
  })

  it('still refuses a later attempt once a charged attempt consumed the admission', async () => {
    const first = await executingOperation()
    const granted = await authority.authorizeProperty(descriptor(first), BINDING)
    if (granted.status !== 'admitted') throw new Error(`not admitted: ${granted.code}`)
    const usage = { inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 100 }
    await authority.settle(
      settlement({ ...first, nonce: granted.nonce }, usage),
      SIGNING_KID,
    )

    const second = await claimNextAttempt(first.operationId, 2)
    await expect(
      authority.authorizeProperty(descriptor(second), {
        ...BINDING,
        hmac: 'C'.repeat(43),
      }),
    ).resolves.toEqual({ status: 'denied', code: 'already_consumed' })
  })

  it('still refuses a later attempt while the previous admission is unsettled', async () => {
    const first = await executingOperation()
    const granted = await authority.authorizeProperty(descriptor(first), BINDING)
    if (granted.status !== 'admitted') throw new Error(`not admitted: ${granted.code}`)

    const second = await claimNextAttempt(first.operationId, 2)
    await expect(
      authority.authorizeProperty(descriptor(second), {
        ...BINDING,
        hmac: 'C'.repeat(43),
      }),
    ).resolves.toEqual({ status: 'denied', code: 'already_consumed' })
  })
})
