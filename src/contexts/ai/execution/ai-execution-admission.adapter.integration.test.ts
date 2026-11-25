// The admission adapter is the last authority before a provider call and the
// only caller of the budget ledger in production. It admits only the executing
// attempt the descriptor names, only while the consent, epochs, processing
// profile, control generations and review source the operation was claimed
// under still stand, and only while the operation holds no open or charged
// reservation. A settlement is priced from usage once.

import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { getPool } from '#/shared/db/pool'
import {
  aiOrganizationCostWindows,
  aiPropertyProcessingProfiles,
  reviews,
  reviewSourceContents,
} from '#/shared/db/schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { type AiOperationFixture } from '#/shared/db/testing/ai-operation-fixture'
import { AI_REPLY_ADOPTION_WINDOW_MILLIS } from '#/shared/reply/ai-reply-provenance'
import { isMintedAiExecutionAdmission } from '#/shared/ai-provider-control/execution-admission'
import { createAiExecutionAdmissionAdapter } from './ai-execution-admission.adapter.server'
import {
  SOURCE_DIGEST,
  SOURCE_BYTES,
  RESERVED,
  buildAdmissionDescriptor,
  createAdmissionDbHelpers,
  deferred,
  seedExecutingOperation,
  useAiOperationFixture,
  type AdmissionScope as Scope,
} from './ai-admission.test-fixtures'

const NOW = new Date(Date.now() - 60_000)
const ORGANIZATION_ID = organizationId('ai-admission-test-org')
const PROPERTY_ID = propertyId('76000000-0000-4000-8000-000000000001')
const SCOPE: Scope = { organizationId: ORGANIZATION_ID, propertyId: PROPERTY_ID }

const descriptor = (
  input: { operationId: string; permitId: string; attemptNumber?: number },
  scope: Scope = SCOPE,
) =>
  buildAdmissionDescriptor(
    { now: NOW, idPrefix: '76', actorId: 'ai-admission-test-user' },
    input,
    scope,
  )

const db = getDb()
const authority = createAiExecutionAdmissionAdapter({
  pool: getPool(),
  now: () => NOW,
})
const { costWindow, operationRow, untilALockWaits, expectNothingReserved } =
  createAdmissionDbHelpers(db, ORGANIZATION_ID)

describe.sequential('AI execution admission (real PostgreSQL)', () => {
  const fixture = useAiOperationFixture(db, NOW, {
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    actorUserId: 'ai-admission-test-user',
  })
  const executingOperation = () => seedExecutingOperation(fixture())

  it('admits the executing attempt once; a repeat is refused, not replayed', async () => {
    const subject = await executingOperation()

    const granted = await authority.authorize(descriptor(subject))
    expect(granted).toMatchObject({
      status: 'admitted',
      admission: {
        operationId: subject.operationId,
        permitId: subject.permitId,
        attemptNumber: 1,
        issuedAtEpochMillis: NOW.getTime(),
        expiresAtEpochMillis: NOW.getTime() + 70_000,
      },
    })
    if (granted.status !== 'admitted') throw new Error('unreachable')
    expect(isMintedAiExecutionAdmission(granted.admission)).toBe(true)
    const admittedWindow = await costWindow()

    // Another process holds its own admissions: admitting again would dispatch
    // a second time against one reservation.
    await expect(authority.authorize(descriptor(subject))).resolves.toEqual({
      status: 'denied',
      code: 'already_consumed',
    })
    await expect(
      authority.authorize({ ...descriptor(subject), permitId: randomUUID() }),
    ).resolves.toEqual({ status: 'denied', code: 'subject_mismatch' })
    await expect(operationRow(subject.operationId)).resolves.toMatchObject({
      reservedMicros: RESERVED,
    })
    await expect(costWindow()).resolves.toEqual(admittedWindow)
  })

  it('admits once when two executions of one permit race', async () => {
    const subject = await executingOperation()
    const before = await costWindow()

    const results = await Promise.all([
      authority.authorize(descriptor(subject)),
      authority.authorize(descriptor(subject)),
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

    const granted = await authority.authorize(descriptor(subject))
    if (granted.status !== 'admitted') throw new Error(`not admitted: ${granted.code}`)

    expect(granted.admission.expiresAtEpochMillis).toBe(NOW.getTime() + 70_000)
    expect(granted.admission.replyTokenExpiresAtEpochMillis).toBe(
      NOW.getTime() + AI_REPLY_ADOPTION_WINDOW_MILLIS,
    )
    expect(granted.admission.replyDraftExpiresAtEpochMillis).toBe(
      granted.admission.replyTokenExpiresAtEpochMillis,
    )
  })

  // The accepting transaction also refuses an operation past its own
  // `expires_at`, so the window may never promise adoption time the operation
  // row cannot honour.
  it('never issues an adoption window past the operation row expiry', async () => {
    const permitId = randomUUID()
    const operationId = await fixture().seedOperation({
      state: 'executing',
      executionAttempt: 1,
      executionPermitId: permitId,
      sourceDigest: SOURCE_DIGEST,
      sourceByteCount: SOURCE_BYTES,
      expiresAt: new Date(NOW.getTime() + 90_000),
    })

    const granted = await authority.authorize(descriptor({ operationId, permitId }))
    if (granted.status !== 'admitted') throw new Error(`not admitted: ${granted.code}`)

    expect(granted.admission.replyTokenExpiresAtEpochMillis).toBe(NOW.getTime() + 90_000)
  })

  it('refuses an operation that is not executing', async () => {
    const permitId = randomUUID()
    const operationId = await fixture().seedOperation({
      state: 'pending',
      executionAttempt: 1,
      executionPermitId: permitId,
      sourceDigest: SOURCE_DIGEST,
      sourceByteCount: SOURCE_BYTES,
    })
    await expect(
      authority.authorize(descriptor({ operationId, permitId })),
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
        await expect(authority.authorize(descriptor(subject))).resolves.toEqual({
          status: 'denied',
          code: 'authorization_changed',
        })
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
      await fixture().setCapabilityControl({
        executionState: 'killed',
        admissionState: 'draining',
      })
      await expect(authority.authorize(descriptor(claimedBefore))).resolves.toEqual({
        status: 'denied',
        code: 'control_disabled',
      })

      // Re-opened: accepting again, but under a generation the claim never saw.
      await fixture().setCapabilityControl({
        executionState: 'enabled',
        admissionState: 'accepting',
      })
      await expect(authority.authorize(descriptor(claimedBefore))).resolves.toEqual({
        status: 'denied',
        code: 'authorization_changed',
      })
      await expectNothingReserved(claimedBefore.operationId, before)

      const claimedAfter = await executingOperation()
      await expect(authority.authorize(descriptor(claimedAfter))).resolves.toMatchObject({
        status: 'admitted',
      })
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

      await expect(authority.authorize(descriptor(subject))).resolves.toEqual({
        status: 'denied',
        code: 'source_mismatch',
      })
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
        await fixture().changeConsent('move_reply_drafting_epoch', tx)
        changed.release()
        await hold.released
      })
      await changed.released
      const admission = authority.authorize(descriptor(subject))
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
      const admission = authority.authorize(descriptor(subject))
      await untilALockWaits()
      const revoke = fixture().changeConsent('revoke')
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
      await expect(authority.authorize(descriptor(after))).resolves.toEqual({
        status: 'denied',
        code: 'authorization_changed',
      })
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
  const fixtureA = useAiOperationFixture(db, NOW, {
    ...tenantA,
    actorUserId: 'ai-admission-tenant-a-user',
  })
  const fixtureB = useAiOperationFixture(db, NOW, {
    ...tenantB,
    actorUserId: 'ai-admission-tenant-b-user',
  })
  beforeAll(async () => {
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
  const executing = (fixture: () => AiOperationFixture) =>
    seedExecutingOperation(fixture())

  it('admits one of two concurrent admissions with room for one, and the other tenant beside it', async () => {
    const [firstA, secondA, onlyB] = await Promise.all([
      executing(fixtureA),
      executing(fixtureA),
      executing(fixtureB),
    ])

    const [resultA1, resultA2, resultB] = await Promise.all([
      authority.authorize(descriptor(firstA, tenantA)),
      authority.authorize(descriptor(secondA, tenantA)),
      authority.authorize(descriptor(onlyB, tenantB)),
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
      authority.authorize(descriptor(await executing(fixtureA), tenantA)),
    ).resolves.toEqual({ status: 'denied', code: 'quota_exhausted' })
    await expect(
      authority.authorize(descriptor(await executing(fixtureB), tenantB)),
    ).resolves.toMatchObject({ status: 'admitted' })
  })
})
