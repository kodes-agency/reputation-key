// The admission adapter is the last authority before a provider call and the
// only caller of the budget ledger in production. It admits only the executing
// attempt the descriptor names, only while the consent, epochs, processing
// profile, control generations and review source the operation was claimed
// under still stand, and only while the operation holds no open or charged
// reservation. A settlement is priced from usage once.

import { randomBytes, randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { getPool } from '#/shared/db/pool'
import {
  aiOperations,
  aiOrganizationCostWindows,
  aiPropertyProcessingProfiles,
  reviews,
  reviewSourceContents,
} from '#/shared/db/schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import { replyDynamicDeveloperBytes } from '#/shared/reply-drafting-v2-request'
import { maximumCostMicros, settledCostMicros } from '#/shared/ai-openai-provider-profile'
import type {
  AiAdmissionDescriptorV1,
  AiSettlementRequestV1,
} from '#/shared/ai-internal-transport-contract'
import {
  AI_REPLY_OPERATION_PROFILE,
  AI_REPLY_V2_DEFAULT_BINDING,
  installAiOperationFixture,
  type AiOperationFixture,
} from '#/shared/db/testing/ai-operation-fixture'
import { AI_REPLY_ADOPTION_WINDOW_MILLIS } from '#/shared/ai-reply-provenance'
import { createAiBudgetControl, reapStaleAiReservations } from '#/shared/db/ai/ai-budget'
import { createAiExecutionAdmissionAdapter } from './ai-execution-admission.adapter'

type PropertyDescriptor = Extract<AiAdmissionDescriptorV1, { subjectKind: 'property' }>
type Scope = Readonly<{ organizationId: string; propertyId: string }>

const NOW = new Date(Date.now() - 60_000)
const ORGANIZATION_ID = organizationId('ai-admission-test-org')
const PROPERTY_ID = propertyId('76000000-0000-4000-8000-000000000001')
const SCOPE: Scope = { organizationId: ORGANIZATION_ID, propertyId: PROPERTY_ID }
const SIGNING_KID = 'grant-v1'

const SOURCE_DIGEST = 'd'.repeat(64)
const SOURCE_BYTES = 40
const PAYLOAD_BYTES = 512
const BINDING = { keyId: 'binding-v1', hmac: 'A'.repeat(43) } as const

const replyProfile = AI_OPERATION_PROFILES.find(
  (candidate) => candidate.profileVersion === AI_REPLY_OPERATION_PROFILE.profileVersion,
)
if (!replyProfile) throw new Error('reply-suggestion profile is not registered')
// A reply v2 request carries a per-request part of its prompt that the profile's
// static figure does not include; admission prices it in.
const RESERVED = maximumCostMicros(
  {
    ...replyProfile,
    staticTokenBearingBytes:
      replyProfile.staticTokenBearingBytes +
      replyDynamicDeveloperBytes(replyProfile.profileVersion),
  },
  PAYLOAD_BYTES,
)

function descriptor(
  input: { operationId: string; permitId: string; attemptNumber?: number },
  scope: Scope = SCOPE,
): PropertyDescriptor {
  // The adapter reads route, ids, attempt, permit, digest, byte count, profile
  // versions and deadline; every fence it re-reads comes from the locked row.
  return {
    version: 'ai-admission-descriptor-v1',
    subjectKind: 'property',
    route: 'reply-suggestion',
    operationId: input.operationId,
    permitId: input.permitId,
    attemptNumber: input.attemptNumber ?? 1,
    organizationId: scope.organizationId,
    propertyId: scope.propertyId,
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
      replyDraftingV2: AI_REPLY_V2_DEFAULT_BINDING,
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
    providerPayloadByteCount: PAYLOAD_BYTES,
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

const db = getDb()
const authority = createAiExecutionAdmissionAdapter({
  pool: getPool(),
  signingKid: SIGNING_KID,
  now: () => NOW,
})

async function settle(request: AiSettlementRequestV1, grantKid: string) {
  const { operationId, permitId, attemptNumber, nonce, ...outcome } = request
  return authority.settle(
    { operationId, permitId, attemptNumber, nonce, grantKid },
    outcome,
  )
}

async function costWindow(organization: string = ORGANIZATION_ID) {
  const [row] = await db
    .select({
      reservedMicros: aiOrganizationCostWindows.reservedMicros,
      settledMicros: aiOrganizationCostWindows.settledMicros,
    })
    .from(aiOrganizationCostWindows)
    .where(eq(aiOrganizationCostWindows.organizationId, organization))
  return row ?? { reservedMicros: 0, settledMicros: 0 }
}

async function operationRow(operationId: string) {
  const [row] = await db
    .select({
      reviewId: aiOperations.reviewId,
      admissionNonce: aiOperations.admissionNonce,
      requestBindingHmac: aiOperations.requestBindingHmac,
      grantKid: aiOperations.grantKid,
      costWindowId: aiOperations.costWindowId,
      reservedMicros: aiOperations.reservedMicros,
      budgetSettledAt: aiOperations.budgetSettledAt,
      actualMicros: aiOperations.actualMicros,
    })
    .from(aiOperations)
    .where(eq(aiOperations.id, operationId))
  if (!row) throw new Error('operation missing')
  return row
}

/** Wait until some session is blocked on a row lock, without a timer. */
async function untilALockWaits(): Promise<void> {
  for (let polls = 0; polls < 500; polls += 1) {
    const waiting = await db.execute<{ waiting: number }>(
      sql`SELECT count(*)::int AS "waiting" FROM pg_locks WHERE NOT granted`,
    )
    if ((waiting.rows[0]?.waiting ?? 0) > 0) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error('no session ever waited on a lock')
}

function deferred() {
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  return { release, released }
}

/** A refused admission sent nothing: no reservation on the row or the window. */
async function expectNothingReserved(operationId: string, windowBefore: object) {
  await expect(operationRow(operationId)).resolves.toMatchObject({
    admissionNonce: null,
    costWindowId: null,
    reservedMicros: 0,
  })
  await expect(costWindow()).resolves.toEqual(windowBefore)
}

describe.sequential('AI execution admission (real PostgreSQL)', () => {
  let fixture: AiOperationFixture

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

  it('admits the executing attempt once; a repeat with the same binding is refused, not replayed', async () => {
    const subject = await executingOperation()

    const granted = await authority.authorizeProperty(descriptor(subject), BINDING)
    expect(granted).toMatchObject({
      status: 'admitted',
      issuedAtEpochMillis: NOW.getTime(),
      expiresAtEpochMillis: NOW.getTime() + 70_000,
    })
    if (granted.status !== 'admitted') throw new Error('unreachable')
    expect(granted.nonce).not.toBe('')
    const admittedWindow = await costWindow()

    // Another process holds its own grant registry: replaying the nonce to it
    // would dispatch a second time against one reservation.
    await expect(
      authority.authorizeProperty(descriptor(subject), BINDING),
    ).resolves.toEqual({
      status: 'denied',
      code: 'already_consumed',
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
    await expect(operationRow(subject.operationId)).resolves.toMatchObject({
      admissionNonce: granted.nonce,
      grantKid: SIGNING_KID,
      requestBindingHmac: BINDING.hmac,
      reservedMicros: RESERVED,
    })
    await expect(costWindow()).resolves.toEqual(admittedWindow)
  })

  it('admits once when two executions of one permit race', async () => {
    const subject = await executingOperation()
    const before = await costWindow()

    const results = await Promise.all([
      authority.authorizeProperty(descriptor(subject), BINDING),
      authority.authorizeProperty(descriptor(subject), BINDING),
    ])

    expect(results.filter((result) => result.status === 'admitted')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'denied')).toEqual([
      { status: 'denied', code: 'already_consumed' },
    ])
    await expect(costWindow()).resolves.toEqual({
      reservedMicros: before.reservedMicros + RESERVED,
      settledMicros: before.settledMicros,
    })
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

  describe('final authority before send', () => {
    it('refuses once the processing profile moved after the claim', async () => {
      const subject = await executingOperation()
      const before = await costWindow()
      await db
        .update(aiPropertyProcessingProfiles)
        .set({ profileVersion: 2 })
        .where(eq(aiPropertyProcessingProfiles.propertyId, PROPERTY_ID))
      try {
        await expect(
          authority.authorizeProperty(descriptor(subject), BINDING),
        ).resolves.toEqual({ status: 'denied', code: 'authorization_changed' })
        await expectNothingReserved(subject.operationId, before)
      } finally {
        await db
          .update(aiPropertyProcessingProfiles)
          .set({ profileVersion: 1 })
          .where(eq(aiPropertyProcessingProfiles.propertyId, PROPERTY_ID))
      }
    })

    it('refuses once a control generation moved after the claim, and reports a stopped control as such', async () => {
      const claimedBefore = await executingOperation()
      const before = await costWindow()
      await fixture.setCapabilityControl({
        executionState: 'killed',
        admissionState: 'draining',
      })
      await expect(
        authority.authorizeProperty(descriptor(claimedBefore), BINDING),
      ).resolves.toEqual({ status: 'denied', code: 'control_disabled' })

      // Re-opened: accepting again, but under a generation the claim never saw.
      await fixture.setCapabilityControl({
        executionState: 'enabled',
        admissionState: 'accepting',
      })
      await expect(
        authority.authorizeProperty(descriptor(claimedBefore), BINDING),
      ).resolves.toEqual({ status: 'denied', code: 'authorization_changed' })
      await expectNothingReserved(claimedBefore.operationId, before)

      const claimedAfter = await executingOperation()
      await expect(
        authority.authorizeProperty(descriptor(claimedAfter), BINDING),
      ).resolves.toMatchObject({ status: 'admitted' })
    })

    it.each([
      [
        'its revision',
        (reviewId: string) =>
          db.update(reviews).set({ sourceRevision: 2 }).where(eq(reviews.id, reviewId)),
      ],
      [
        'its canonical source',
        (reviewId: string) =>
          db
            .update(reviewSourceContents)
            .set({ aiSourceDigest: 'f'.repeat(64) })
            .where(eq(reviewSourceContents.reviewId, reviewId)),
      ],
      [
        'the expiry of its content',
        (reviewId: string) =>
          db
            .update(reviewSourceContents)
            .set({ contentExpiresAt: NOW })
            .where(eq(reviewSourceContents.reviewId, reviewId)),
      ],
      [
        'its reply state',
        (reviewId: string) =>
          db.execute(sql`
            INSERT INTO replies (review_id, organization_id, text, status, source)
            VALUES (${reviewId}::uuid, ${ORGANIZATION_ID}, 'A reply', 'draft', 'internal')
          `),
      ],
    ])('refuses once the review moved after the claim: %s', async (_change, move) => {
      const subject = await executingOperation()
      const { reviewId } = await operationRow(subject.operationId)
      if (reviewId === null) throw new Error('operation has no review')
      const before = await costWindow()
      await move(reviewId)

      await expect(
        authority.authorizeProperty(descriptor(subject), BINDING),
      ).resolves.toEqual({ status: 'denied', code: 'source_mismatch' })
      await expectNothingReserved(subject.operationId, before)
      await db.execute(sql`DELETE FROM replies WHERE review_id = ${reviewId}::uuid`)
    })

    // The two consent changes run last: the revoke leaves the Property without
    // consent for anything claimed after it.
    it('sees a change committed while the admission waits on its share lock', async () => {
      const subject = await executingOperation()
      const before = await costWindow()
      const hold = deferred()
      const changed = deferred()
      const change = db.transaction(async (tx) => {
        await fixture.changeConsent('move_reply_drafting_epoch', tx)
        changed.release()
        await hold.released
      })
      await changed.released
      const admission = authority.authorizeProperty(descriptor(subject), BINDING)
      await untilALockWaits()
      hold.release()
      await change

      await expect(admission).resolves.toEqual({
        status: 'denied',
        code: 'authorization_changed',
      })
      await expectNothingReserved(subject.operationId, before)
    })

    it('admits before a revoke that waits on its share lock, without a deadlock', async () => {
      const subject = await executingOperation()
      const { reviewId } = await operationRow(subject.operationId)
      if (reviewId === null) throw new Error('operation has no review')
      // Hold the review so the admission stops after it has share-locked the
      // consent, then let the revoke queue behind that share lock.
      const holdReview = deferred()
      const reviewHeld = deferred()
      const review = db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT 1 FROM reviews WHERE id = ${reviewId}::uuid FOR UPDATE`,
        )
        reviewHeld.release()
        await holdReview.released
      })
      await reviewHeld.released
      const admission = authority.authorizeProperty(descriptor(subject), BINDING)
      await untilALockWaits()
      const revoke = fixture.changeConsent('revoke')
      await expect(
        Promise.race([
          revoke.then(() => 'revoked'),
          new Promise((resolve) => setImmediate(() => resolve('waiting'))),
        ]),
      ).resolves.toBe('waiting')
      holdReview.release()
      await review

      await expect(admission).resolves.toMatchObject({ status: 'admitted' })
      await expect(revoke).resolves.toBeUndefined()
      const after = await executingOperation()
      await expect(
        authority.authorizeProperty(descriptor(after), BINDING),
      ).resolves.toEqual({
        status: 'denied',
        code: 'authorization_changed',
      })
    })
  })
})

describe.sequential('AI execution admission settlement (real PostgreSQL)', () => {
  let fixture: AiOperationFixture
  const ORGANIZATION = organizationId('ai-admission-settlement-test-org')
  const PROPERTY = propertyId('76000000-0000-4000-8000-000000000021')
  const scope: Scope = { organizationId: ORGANIZATION, propertyId: PROPERTY }
  const window = () => costWindow(ORGANIZATION)

  beforeAll(async () => {
    fixture = await installAiOperationFixture({
      db,
      organizationId: ORGANIZATION,
      propertyId: PROPERTY,
      actorUserId: 'ai-admission-settlement-test-user',
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
  const admit = async (subject: { operationId: string; permitId: string }) => {
    const granted = await authority.authorizeProperty(descriptor(subject, scope), BINDING)
    if (granted.status !== 'admitted') throw new Error(`not admitted: ${granted.code}`)
    return granted
  }
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
  const authorizeNext = (next: {
    operationId: string
    permitId: string
    attemptNumber: number
  }) =>
    authority.authorizeProperty(descriptor(next, scope), {
      ...BINDING,
      hmac: 'C'.repeat(43),
    })

  it('settles a granted operation from usage once and refuses a different cost afterwards', async () => {
    const subject = await executingOperation()
    const granted = await admit(subject)
    const usage = { inputTokens: 1_000, cachedInputTokens: 200, outputTokens: 300 }
    const cost = Number(settledCostMicros(usage))

    await expect(
      settle(settlement({ ...subject, nonce: granted.nonce }, usage), SIGNING_KID),
    ).resolves.toMatchObject({
      status: 'settled',
      costMicros: cost,
      settlementState: 'settled',
      grantKid: SIGNING_KID,
      requestBindingHmac: BINDING.hmac,
    })
    await expect(
      settle(settlement({ ...subject, nonce: granted.nonce }, usage), SIGNING_KID),
    ).resolves.toMatchObject({ status: 'settled', costMicros: cost })
    await expect(
      settle(
        settlement({ ...subject, nonce: granted.nonce }, { ...usage, outputTokens: 301 }),
        SIGNING_KID,
      ),
    ).resolves.toEqual({ status: 'denied', code: 'settlement_conflict' })
    await expect(
      settle(
        settlement({ ...subject, nonce: 'someone-elses-nonce' }, usage),
        SIGNING_KID,
      ),
    ).resolves.toEqual({ status: 'denied', code: 'permit_mismatch' })
    await expect(
      settle(settlement({ ...subject, nonce: granted.nonce }, usage), 'grant-v2'),
    ).resolves.toEqual({ status: 'denied', code: 'permit_mismatch' })
  })

  it('refuses a malformed operation ID without changing the budget', async () => {
    const subject = await executingOperation()
    const granted = await admit(subject)
    const before = await window()
    await expect(
      settle(
        settlement(
          { ...subject, operationId: 'not-a-uuid', nonce: granted.nonce },
          { inputTokens: 1_000, cachedInputTokens: 200, outputTokens: 300 },
        ),
        SIGNING_KID,
      ),
    ).resolves.toEqual({ status: 'denied', code: 'settlement_conflict' })
    await expect(window()).resolves.toEqual(before)
  })

  it.each(['someone-elses-nonce', 'YW5vdGhlci1ub25jZQ'])(
    'refuses a different nonce before and after settlement without changing the budget: %s',
    async (nonce) => {
      const subject = await executingOperation()
      const granted = await admit(subject)
      const usage = { inputTokens: 1_000, cachedInputTokens: 200, outputTokens: 300 }
      const mismatched = settlement({ ...subject, nonce }, usage)

      const reserved = await window()
      await expect(settle(mismatched, SIGNING_KID)).resolves.toEqual({
        status: 'denied',
        code: 'permit_mismatch',
      })
      await expect(window()).resolves.toEqual(reserved)

      await expect(
        settle(settlement({ ...subject, nonce: granted.nonce }, usage), SIGNING_KID),
      ).resolves.toMatchObject({
        status: 'settled',
        costMicros: Number(settledCostMicros(usage)),
      })
      const settled = await window()
      await expect(settle(mismatched, SIGNING_KID)).resolves.toEqual({
        status: 'denied',
        code: 'permit_mismatch',
      })
      await expect(window()).resolves.toEqual(settled)
    },
  )

  it.each([
    { inputTokens: -1, cachedInputTokens: 0, outputTokens: 1 },
    { inputTokens: 1, cachedInputTokens: 2, outputTokens: 1 },
    { inputTokens: 1.5, cachedInputTokens: 0, outputTokens: 1 },
  ])('refuses invalid usage without settling the budget: %j', async (usage) => {
    const subject = await executingOperation()
    const granted = await admit(subject)
    const before = await window()
    await expect(
      settle(settlement({ ...subject, nonce: granted.nonce }, usage), SIGNING_KID),
    ).resolves.toEqual({ status: 'denied', code: 'settlement_conflict' })
    await expect(window()).resolves.toEqual(before)
    await expect(operationRow(subject.operationId)).resolves.toMatchObject({
      budgetSettledAt: null,
      actualMicros: null,
    })
  })

  // A timeout, a lost connection, a 400 or a 401, an unreadable answer: the call may
  // have been billed in full and nothing says how much.
  it.each([
    ['transport_ambiguous', 'transport_ambiguous', 'ambiguous'],
    ['deadline_exceeded', 'deadline_exceeded', 'settled'],
    ['provider_refused', 'provider_refused', 'settled'],
    ['provider_unavailable', 'provider_unavailable', 'settled'],
    ['output_invalid', 'success', 'settled'],
  ] as const)(
    'charges unknown usage (%s) at the reservation and rejects a later lower-cost settlement',
    async (disposition, reportedDisposition, settlementState) => {
      const subject = await executingOperation()
      const granted = await admit(subject)
      const { reservedMicros } = await operationRow(subject.operationId)
      expect(reservedMicros).toBeGreaterThan(0)
      const unknown = {
        ...noDispatch({ ...subject, nonce: granted.nonce }),
        disposition,
        reportedDisposition,
      }

      await expect(settle(unknown, SIGNING_KID)).resolves.toMatchObject({
        status: 'settled',
        usageKnown: false,
        costMicros: reservedMicros,
        settlementState,
      })
      await expect(settle(unknown, SIGNING_KID)).resolves.toMatchObject({
        status: 'settled',
        costMicros: reservedMicros,
      })
      await expect(
        settle(
          settlement(
            { ...subject, nonce: granted.nonce },
            { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
          ),
          SIGNING_KID,
        ),
      ).resolves.toEqual({ status: 'denied', code: 'settlement_conflict' })
      await expect(
        authorizeNext(await claimNextAttempt(subject.operationId, 2)),
      ).resolves.toEqual({ status: 'denied', code: 'already_consumed' })
    },
  )

  it('lets only one competing settlement change the monthly counter', async () => {
    const subject = await executingOperation()
    const granted = await admit(subject)
    const { reservedMicros } = await operationRow(subject.operationId)
    const before = await window()
    const results = await Promise.all(
      [100, 300].map((outputTokens) =>
        settle(
          settlement(
            { ...subject, nonce: granted.nonce },
            { inputTokens: 1_000, cachedInputTokens: 0, outputTokens },
          ),
          SIGNING_KID,
        ),
      ),
    )
    const winners = results.filter((result) => result.status === 'settled')
    expect(winners).toHaveLength(1)
    expect(results.filter((result) => result.status === 'denied')).toEqual([
      { status: 'denied', code: 'settlement_conflict' },
    ])
    const winner = winners[0]
    if (!winner || winner.status !== 'settled') throw new Error('settlement missing')
    await expect(window()).resolves.toEqual({
      reservedMicros: before.reservedMicros - reservedMicros,
      settledMicros: before.settledMicros + winner.costMicros,
    })
  })

  // Reproduced on the closed beta (2026-09-29): during an import burst, database
  // waits left three analyses less grant time than the provider call needs, so
  // the gateway withheld dispatch and released the grant. Every later attempt
  // was then refused as `already_consumed`, the caller read that as an
  // ambiguous provider outcome, and after four attempts the reviews were
  // settled without an analysis. Nothing had been spent.
  it('admits the next attempt once the previous admission was released without dispatch', async () => {
    const first = await executingOperation()
    const granted = await admit(first)
    await expect(
      settle(noDispatch({ ...first, nonce: granted.nonce }), SIGNING_KID),
    ).resolves.toMatchObject({
      status: 'settled',
      costMicros: 0,
      settlementState: 'released',
    })

    const second = await claimNextAttempt(first.operationId, 2)
    const regranted = await authorizeNext(second)

    expect(regranted).toMatchObject({ status: 'admitted' })
    if (regranted.status !== 'admitted') throw new Error('unreachable')
    expect(regranted.nonce).not.toBe(granted.nonce)
    await expect(operationRow(first.operationId)).resolves.toMatchObject({
      requestBindingHmac: 'C'.repeat(43),
      reservedMicros: RESERVED,
      budgetSettledAt: null,
      actualMicros: null,
    })

    // The fresh admission is settled from its own usage, once.
    const usage = { inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 100 }
    await expect(
      settle(settlement({ ...second, nonce: regranted.nonce }, usage), SIGNING_KID),
    ).resolves.toMatchObject({
      status: 'settled',
      costMicros: Number(settledCostMicros(usage)),
      settlementState: 'settled',
    })
    // The released first attempt can no longer settle against the operation.
    await expect(
      settle(noDispatch({ ...first, nonce: granted.nonce }), SIGNING_KID),
    ).resolves.toEqual({ status: 'denied', code: 'permit_mismatch' })
  })

  // Closed beta, 2026-10-24: OpenAI answered 429 to every call. The connector
  // reports a refusal by status as known usage of nothing, so the gateway's
  // expected cost is the zero this authority charges, and the retry the
  // analysis schedules is admitted afresh.
  it.each([
    ['rate_limited', true, 20],
    ['quota_exhausted', false, null],
    ['provider_unavailable', true, null],
  ] as const)(
    'charges a %s refusal nothing and admits the next attempt',
    async (disposition, providerRetryable, retryAfterSeconds) => {
      const first = await executingOperation()
      const granted = await admit(first)
      await expect(
        settle(
          {
            ...settlement(
              { ...first, nonce: granted.nonce },
              { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
            ),
            disposition,
            reportedDisposition: disposition,
            providerRetryable,
            retryAfterSeconds,
          },
          SIGNING_KID,
        ),
      ).resolves.toMatchObject({
        status: 'settled',
        disposition,
        usageKnown: true,
        costMicros: 0,
        settlementState: 'settled',
      })

      await expect(
        authorizeNext(await claimNextAttempt(first.operationId, 2)),
      ).resolves.toMatchObject({ status: 'admitted' })
    },
  )

  it('still refuses a later attempt once a charged attempt consumed the admission', async () => {
    const first = await executingOperation()
    const granted = await admit(first)
    const usage = { inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 100 }
    await settle(settlement({ ...first, nonce: granted.nonce }, usage), SIGNING_KID)

    await expect(
      authorizeNext(await claimNextAttempt(first.operationId, 2)),
    ).resolves.toEqual({ status: 'denied', code: 'already_consumed' })
  })

  it('still refuses a later attempt while the previous admission is unsettled', async () => {
    const first = await executingOperation()
    await admit(first)

    await expect(
      authorizeNext(await claimNextAttempt(first.operationId, 2)),
    ).resolves.toEqual({ status: 'denied', code: 'already_consumed' })
  })

  it('charges an expired admission once and refuses a late settlement with a different cost', async () => {
    const subject = await executingOperation()
    const granted = await admit(subject)
    const { reservedMicros } = await operationRow(subject.operationId)
    await db
      .update(aiOperations)
      .set({ budgetReservedAt: sql`clock_timestamp() - interval '16 minutes'` })
      .where(eq(aiOperations.id, subject.operationId))
    await db.transaction(reapStaleAiReservations)

    await expect(operationRow(subject.operationId)).resolves.toMatchObject({
      actualMicros: reservedMicros,
    })
    await expect(
      settle(noDispatch({ ...subject, nonce: granted.nonce }), SIGNING_KID),
    ).resolves.toEqual({ status: 'denied', code: 'settlement_conflict' })
  })

  // While the previous release still runs beside this one, it admits rows the
  // same way: a reservation in the budget ledger and the four admission columns,
  // in one transaction. Such a row behaves here by its reservation alone.
  describe('a row admitted by the previous release', () => {
    const budget = createAiBudgetControl({ idGen: randomUUID, now: () => NOW })
    const admittedByPreviousRelease = async () => {
      const subject = await executingOperation()
      const nonce = randomBytes(18).toString('base64url')
      await db.transaction(async (tx) => {
        const reserved = await budget.admitAiOperation(tx, {
          organizationId: ORGANIZATION,
          propertyId: PROPERTY,
          operationKey: subject.operationId,
          routeKey: AI_REPLY_OPERATION_PROFILE.routeKey,
          operationProfileVersion: AI_REPLY_OPERATION_PROFILE.profileVersion,
          providerPayloadBytes: PAYLOAD_BYTES,
        })
        if (!reserved.ok) throw new Error(`not reserved: ${reserved.code}`)
        await tx
          .update(aiOperations)
          .set({
            admissionNonce: nonce,
            requestBindingKeyId: BINDING.keyId,
            requestBindingHmac: BINDING.hmac,
            grantKid: SIGNING_KID,
          })
          .where(eq(aiOperations.id, subject.operationId))
      })
      return { ...subject, nonce }
    }

    it('is refused while open, even for the binding that admitted it', async () => {
      const subject = await admittedByPreviousRelease()
      await expect(
        authority.authorizeProperty(descriptor(subject, scope), BINDING),
      ).resolves.toEqual({ status: 'denied', code: 'already_consumed' })
    })

    it('admits the next attempt once released, and refuses it once charged', async () => {
      const released = await admittedByPreviousRelease()
      await expect(settle(noDispatch(released), SIGNING_KID)).resolves.toMatchObject({
        status: 'settled',
        settlementState: 'released',
      })
      await expect(
        authorizeNext(await claimNextAttempt(released.operationId, 2)),
      ).resolves.toMatchObject({ status: 'admitted' })

      const charged = await admittedByPreviousRelease()
      await settle(
        settlement(charged, { inputTokens: 10, cachedInputTokens: 0, outputTokens: 10 }),
        SIGNING_KID,
      )
      await expect(
        authorizeNext(await claimNextAttempt(charged.operationId, 2)),
      ).resolves.toEqual({ status: 'denied', code: 'already_consumed' })
    })
  })
})

describe.sequential('AI execution admission across tenants (real PostgreSQL)', () => {
  const tenantA: Scope = {
    organizationId: organizationId('ai-admission-tenant-a'),
    propertyId: propertyId('76000000-0000-4000-8000-000000000031'),
  }
  const tenantB: Scope = {
    organizationId: organizationId('ai-admission-tenant-b'),
    propertyId: propertyId('76000000-0000-4000-8000-000000000032'),
  }
  let fixtureA: AiOperationFixture
  let fixtureB: AiOperationFixture

  beforeAll(async () => {
    fixtureA = await installAiOperationFixture({
      db,
      ...tenantA,
      actorUserId: 'ai-admission-tenant-a-user',
      now: NOW,
    })
    fixtureB = await installAiOperationFixture({
      db,
      ...tenantB,
      actorUserId: 'ai-admission-tenant-b-user',
      now: NOW,
    })
    // Tenant A has room for exactly one more reservation this month.
    await db.insert(aiOrganizationCostWindows).values({
      id: randomUUID(),
      organizationId: tenantA.organizationId,
      windowStart: sql`date_trunc('month', ${NOW}::timestamptz)`,
      reservedMicros: 0,
      settledMicros: 50_000_000 - RESERVED,
      capMicros: 50_000_000,
      updatedAt: NOW,
    })
  })

  afterAll(async () => {
    await fixtureB.remove()
    await fixtureA.remove()
  })

  const executing = async (fixture: AiOperationFixture) => {
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

  it('admits one of two concurrent admissions with room for one, and the other tenant beside it', async () => {
    const [firstA, secondA, onlyB] = await Promise.all([
      executing(fixtureA),
      executing(fixtureA),
      executing(fixtureB),
    ])

    const [resultA1, resultA2, resultB] = await Promise.all([
      authority.authorizeProperty(descriptor(firstA, tenantA), BINDING),
      authority.authorizeProperty(descriptor(secondA, tenantA), BINDING),
      authority.authorizeProperty(descriptor(onlyB, tenantB), BINDING),
    ])

    expect([resultA1.status, resultA2.status].sort()).toEqual(['admitted', 'denied'])
    expect([resultA1, resultA2].find((result) => result.status === 'denied')).toEqual({
      status: 'denied',
      code: 'quota_exhausted',
    })
    expect(resultB).toMatchObject({ status: 'admitted' })
    await expect(costWindow(tenantA.organizationId)).resolves.toEqual({
      reservedMicros: RESERVED,
      settledMicros: 50_000_000 - RESERVED,
    })

    // A at its cap stays refused while B goes on being admitted.
    await expect(
      authority.authorizeProperty(
        descriptor(await executing(fixtureA), tenantA),
        BINDING,
      ),
    ).resolves.toEqual({ status: 'denied', code: 'quota_exhausted' })
    await expect(
      authority.authorizeProperty(
        descriptor(await executing(fixtureB), tenantB),
        BINDING,
      ),
    ).resolves.toMatchObject({ status: 'admitted' })
  })
})
