import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  notificationDigestBatchMembers,
  notificationDigestBatches,
  notificationEmailQueue,
  notifications,
  properties,
} from '#/shared/db/schema'
import {
  notificationDigestBatchId,
  notificationEmailId,
  organizationId,
  userId,
} from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  digestBatchIdempotencyKey,
  digestMemberSet,
  digestProviderRequest,
} from '../digest-batch-identity'
import {
  findDigestBatchEntries,
  findOpenDigestBatch,
  prepareDigestBatch,
  settleDigestBatch,
  startDigestAttempt,
} from '../../email/notification-digest-batch.server'
import {
  findDueEmailRecipients,
  findDueEmailsByUser,
  findNotificationEmailById,
  freezeProviderRequest,
  markNotificationEmailAccepted,
  markNotificationEmailFailed,
  markNotificationEmailSuppressed,
  recordProviderState,
} from '../../email/notification-email-queue.server'

const ORG = organizationId('notification-digest-batch-test-org')
const USER = userId('notification-digest-batch-test-user')
const PROPERTY = '81000000-0000-4000-8000-000000000001'
const EMAIL_A = notificationEmailId('81000000-0000-4000-8000-000000000011')
const EMAIL_B = notificationEmailId('81000000-0000-4000-8000-000000000012')
const EMAIL_LATE = notificationEmailId('81000000-0000-4000-8000-000000000013')
const BATCH = notificationDigestBatchId('81000000-0000-4000-8000-000000000021')
const NOW = new Date('2026-08-25T08:00:00.000Z')
const FROZEN_REQUEST = {
  to: 'manager@example.com',
  subject: 'Your digest',
  html: '<p>Digest</p>',
  text: 'Digest',
  headers: {},
}

const EMAIL_REQUEST = { ...FROZEN_REQUEST, replyTo: null }

const digestBatchInput = (id = BATCH): Parameters<typeof prepareDigestBatch>[1] => {
  const memberIds = [EMAIL_A, EMAIL_B] as const
  const memberDigest = digestMemberSet(memberIds)
  return {
    id,
    organizationId: ORG,
    userId: USER,
    localDate: '2026-08-25',
    memberIds,
    memberDigest,
    contentDigest: digestProviderRequest(FROZEN_REQUEST),
    providerRequest: FROZEN_REQUEST,
    unsubscribeKeyVersion: 'v1',
    providerIdempotencyKey: digestBatchIdempotencyKey({
      organizationId: ORG,
      userId: USER,
      localDate: '2026-08-25',
      batchId: id,
      memberDigest,
    }),
    preparedAt: NOW,
  }
}

describe.sequential('notification digest batch repository (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
  })

  beforeEach(async () => {
    await db
      .delete(notificationDigestBatches)
      .where(eq(notificationDigestBatches.organizationId, ORG))
    await db.delete(properties).where(eq(properties.organizationId, ORG))
    await db.insert(properties).values({
      id: PROPERTY,
      organizationId: ORG,
      name: 'Digest Test Property',
      slug: 'notification-digest-batch-test',
      timezone: 'UTC',
    })
    const notificationRows = [EMAIL_A, EMAIL_B, EMAIL_LATE].map((emailId, index) => ({
      id: `81000000-0000-4000-8000-00000000010${index + 1}`,
      userId: USER,
      organizationId: ORG,
      propertyId: PROPERTY,
      type: 'review.created',
      category: 'urgent_operational',
      priority: 'normal',
      status: 'unread',
      resourceType: 'inbox_item',
      resourceId: `digest-test-resource-${index}`,
      eventId: `digest-test-event-${index}`,
      title: 'New review',
      payload: {},
      createdAt: NOW,
      updatedAt: NOW,
      emailId,
    }))
    await db
      .insert(notifications)
      .values(notificationRows.map(({ emailId: _emailId, ...row }) => row))
    await db.insert(notificationEmailQueue).values(
      notificationRows.map((row, index) => ({
        id: row.emailId,
        notificationId: row.id,
        userId: USER,
        organizationId: ORG,
        propertyId: PROPERTY,
        category: 'urgent_operational',
        cadence: 'daily',
        status: 'pending',
        priority: 'normal',
        idempotencyKey: `digest-test-queue-${index}`,
        createdAt: NOW,
        updatedAt: NOW,
      })),
    )
  })

  afterAll(async () => {
    await db
      ?.delete(notificationDigestBatches)
      .where(eq(notificationDigestBatches.organizationId, ORG))
    await db?.delete(properties).where(eq(properties.organizationId, ORG))
    await lease?.release()
  })

  it('freezes exact members, serializes concurrent preparation, and settles atomically', async () => {
    const input = digestBatchInput()

    const [first, concurrent] = await Promise.all([
      prepareDigestBatch(db, input),
      prepareDigestBatch(
        db,
        digestBatchInput(
          notificationDigestBatchId('81000000-0000-4000-8000-000000000022'),
        ),
      ),
    ])
    const owner = first.created ? first : concurrent
    const follower = first.created ? concurrent : first
    expect(owner.created).toBe(true)
    expect(follower).toMatchObject({ created: false, batch: { id: owner.batch.id } })

    const frozen = await findDigestBatchEntries(db, owner.batch.id, ORG, USER)
    expect(frozen.map((entry) => entry.id)).toEqual([EMAIL_A, EMAIL_B])

    await db
      .update(notificationEmailQueue)
      .set({ notBefore: new Date('2026-08-26T08:00:00.000Z') })
      .where(eq(notificationEmailQueue.organizationId, ORG))
    await expect(
      findDueEmailRecipients(db, 'daily', new Date('2026-08-25T09:00:00.000Z')),
    ).resolves.toContainEqual({ organizationId: ORG, userId: USER })

    await expect(
      settleDigestBatch(db, {
        batchId: owner.batch.id,
        organizationId: ORG,
        userId: USER,
        expectedContentDigest: 'b'.repeat(64),
        settlement: {
          kind: 'accepted',
          providerMessageId: 'must-not-accept-stale-content',
          acceptedAt: NOW,
        },
      }),
    ).resolves.toBe(false)

    const retryAt = new Date('2026-08-25T08:01:00.000Z')
    await expect(
      settleDigestBatch(db, {
        batchId: owner.batch.id,
        organizationId: ORG,
        userId: USER,
        expectedContentDigest: input.contentDigest,
        settlement: {
          kind: 'rejected',
          classification: 'transient',
          nextAttemptAt: retryAt,
          failedAt: NOW,
          refusedBeforeAcceptance: false,
        },
      }),
    ).resolves.toBe(true)
    await expect(findOpenDigestBatch(db, ORG, USER)).resolves.toMatchObject({
      id: owner.batch.id,
      state: 'retryable',
      retryCount: 1,
    })

    const retryStates = await db
      .select({ id: notificationEmailQueue.id, status: notificationEmailQueue.status })
      .from(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))
    expect(new Map(retryStates.map((row) => [row.id, row.status]))).toEqual(
      new Map([
        [EMAIL_A, 'failed'],
        [EMAIL_B, 'failed'],
        [EMAIL_LATE, 'pending'],
      ]),
    )

    await expect(
      settleDigestBatch(db, {
        batchId: owner.batch.id,
        organizationId: ORG,
        userId: USER,
        expectedContentDigest: input.contentDigest,
        settlement: {
          kind: 'accepted',
          providerMessageId: 'resend-message-1',
          acceptedAt: NOW,
        },
      }),
    ).resolves.toBe(true)

    const states = await db
      .select({ id: notificationEmailQueue.id, status: notificationEmailQueue.status })
      .from(notificationEmailQueue)
      .where(
        and(
          eq(notificationEmailQueue.organizationId, ORG),
          sql`${notificationEmailQueue.id} IN (${EMAIL_A}, ${EMAIL_B}, ${EMAIL_LATE})`,
        ),
      )
    expect(new Map(states.map((row) => [row.id, row.status]))).toEqual(
      new Map([
        [EMAIL_A, 'accepted'],
        [EMAIL_B, 'accepted'],
        [EMAIL_LATE, 'pending'],
      ]),
    )
    await expect(findOpenDigestBatch(db, ORG, USER)).resolves.toBeNull()
  })

  it('rejects a member fingerprint or provider key that does not bind the exact batch', async () => {
    const input = digestBatchInput()

    await expect(
      prepareDigestBatch(db, { ...input, memberDigest: 'b'.repeat(64) }),
    ).rejects.toThrow('Digest batch member fingerprint does not match exact members')
    await expect(
      prepareDigestBatch(db, {
        ...input,
        providerIdempotencyKey: `rk-digest-v2:${'c'.repeat(64)}`,
      }),
    ).rejects.toThrow('Digest batch provider key does not match immutable identity')
    await expect(findOpenDigestBatch(db, ORG, USER)).resolves.toBeNull()
  })

  it('refuses provider outcomes after membership corruption and allows terminal invalidation', async () => {
    const input = digestBatchInput()
    const prepared = await prepareDigestBatch(db, input)

    await db
      .delete(notificationDigestBatchMembers)
      .where(
        and(
          eq(notificationDigestBatchMembers.batchId, prepared.batch.id),
          eq(notificationDigestBatchMembers.notificationEmailId, EMAIL_B),
        ),
      )

    await expect(
      settleDigestBatch(db, {
        batchId: prepared.batch.id,
        organizationId: ORG,
        userId: USER,
        expectedContentDigest: input.contentDigest,
        settlement: {
          kind: 'accepted',
          providerMessageId: 'must-not-settle-partial-membership',
          acceptedAt: NOW,
        },
      }),
    ).resolves.toBe(false)

    const beforeInvalidation = await db
      .select({ id: notificationEmailQueue.id, status: notificationEmailQueue.status })
      .from(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))
    expect(new Map(beforeInvalidation.map((row) => [row.id, row.status]))).toEqual(
      new Map([
        [EMAIL_A, 'pending'],
        [EMAIL_B, 'pending'],
        [EMAIL_LATE, 'pending'],
      ]),
    )

    await expect(
      settleDigestBatch(db, {
        batchId: prepared.batch.id,
        organizationId: ORG,
        userId: USER,
        expectedContentDigest: input.contentDigest,
        settlement: {
          kind: 'invalidated',
          reason: 'digest_membership_changed',
          invalidatedAt: NOW,
        },
      }),
    ).resolves.toBe(true)

    const afterInvalidation = await db
      .select({ id: notificationEmailQueue.id, status: notificationEmailQueue.status })
      .from(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))
    expect(new Map(afterInvalidation.map((row) => [row.id, row.status]))).toEqual(
      new Map([
        [EMAIL_A, 'suppressed'],
        [EMAIL_B, 'pending'],
        [EMAIL_LATE, 'pending'],
      ]),
    )
    await expect(findOpenDigestBatch(db, ORG, USER)).resolves.toBeNull()
  })

  describe('provider delivery events after acceptance (ADR 0046 r.6)', () => {
    const LATER = new Date('2026-08-25T08:05:00.000Z')
    const NEXT_DAY = new Date('2026-08-26T08:00:00.000Z')

    const emailRow = async (id: string) =>
      (
        await db
          .select()
          .from(notificationEmailQueue)
          .where(eq(notificationEmailQueue.id, id))
      )[0]

    const dueIds = async () =>
      (await findDueEmailsByUser(db, ORG, USER, 'daily', NEXT_DAY)).map(
        (entry) => entry.id,
      )

    it('ends a provider-suppressed message as suppressed', async () => {
      // Stopping further mail to the address is the durable suppression's job
      // (notification-email-suppression.repository.test.ts).
      await markNotificationEmailAccepted(
        db,
        EMAIL_A,
        ORG,
        PROPERTY,
        'resend-suppressed-1',
        NOW,
      )

      const moved = await recordProviderState(
        db,
        'resend-suppressed-1',
        'suppressed',
        LATER,
      )

      expect(moved.map((row) => row.emailId)).toEqual([EMAIL_A])
      expect(await emailRow(EMAIL_A)).toMatchObject({
        status: 'suppressed',
        providerState: 'suppressed',
        suppressionReason: 'provider_suppressed',
      })
    })

    it('ends a failure after acceptance as permanent, so no sweep sends it again', async () => {
      await markNotificationEmailAccepted(
        db,
        EMAIL_A,
        ORG,
        PROPERTY,
        'resend-failed-1',
        NOW,
      )

      const moved = await recordProviderState(db, 'resend-failed-1', 'failed', LATER)

      expect(moved).toHaveLength(1)
      expect(await emailRow(EMAIL_A)).toMatchObject({
        status: 'failed',
        providerState: 'failed',
        lastErrorClass: 'permanent',
        failedAt: LATER,
      })
      expect(await dueIds()).not.toContain(EMAIL_A)
    })

    it('keeps a provider-delayed message in flight until the provider settles it', async () => {
      // The queue's own `delayed` is the quiet-hours deferral and is sendable;
      // a provider delay must never make an accepted message sendable again.
      await markNotificationEmailAccepted(
        db,
        EMAIL_A,
        ORG,
        PROPERTY,
        'resend-delayed-1',
        NOW,
      )

      await recordProviderState(db, 'resend-delayed-1', 'delivery_delayed', LATER)

      expect(await emailRow(EMAIL_A)).toMatchObject({
        status: 'accepted',
        providerState: 'delivery_delayed',
      })
      expect(await dueIds()).not.toContain(EMAIL_A)
      await recordProviderState(db, 'resend-delayed-1', 'delivered', NEXT_DAY)
      expect(await emailRow(EMAIL_A)).toMatchObject({
        status: 'delivered',
        providerState: 'delivered',
      })
    })

    it('never lets a late failure, suppression or delay overwrite a delivered message', async () => {
      await markNotificationEmailAccepted(
        db,
        EMAIL_A,
        ORG,
        PROPERTY,
        'resend-late-1',
        NOW,
      )
      await recordProviderState(db, 'resend-late-1', 'delivered', LATER)

      for (const state of ['failed', 'suppressed', 'delivery_delayed'] as const) {
        await expect(
          recordProviderState(db, 'resend-late-1', state, NEXT_DAY),
        ).resolves.toEqual([])
      }
      expect(await emailRow(EMAIL_A)).toMatchObject({
        status: 'delivered',
        providerState: 'delivered',
      })
    })
  })

  it('holds, and never returns as due, digest rows for a Property that is not active', async () => {
    // The urgent path holds these rows too: an archived Property's notices
    // must not reach anyone by either channel.
    const tomorrow = new Date('2026-08-26T08:00:00.000Z')
    await expect(
      findDueEmailsByUser(db, ORG, USER, 'daily', tomorrow),
    ).resolves.toHaveLength(3)

    await db
      .update(properties)
      .set({ lifecycleState: 'archived' })
      .where(eq(properties.id, PROPERTY))

    await expect(findDueEmailsByUser(db, ORG, USER, 'daily', tomorrow)).resolves.toEqual(
      [],
    )
    await expect(
      findDueEmailRecipients(db, 'daily', tomorrow),
    ).resolves.not.toContainEqual({
      organizationId: ORG,
      userId: USER,
    })
    const held = await db
      .select({ status: notificationEmailQueue.status })
      .from(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))
    expect(held.map((row) => row.status)).toEqual(['pending', 'pending', 'pending'])
  })

  it('keeps the first frozen request, returns it to later callers, and clears it when the row closes', async () => {
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)
    const later = { ...EMAIL_REQUEST, subject: 'A later render' }

    const first = await freezeProviderRequest(
      db,
      EMAIL_LATE,
      ORG,
      PROPERTY,
      EMAIL_REQUEST,
      at(0),
    )
    const second = await freezeProviderRequest(
      db,
      EMAIL_LATE,
      ORG,
      PROPERTY,
      later,
      at(1),
    )

    expect(first).toEqual(EMAIL_REQUEST)
    expect(second).toEqual(EMAIL_REQUEST)
    await expect(
      findNotificationEmailById(db, EMAIL_LATE, ORG, PROPERTY),
    ).resolves.toMatchObject({
      providerRequest: EMAIL_REQUEST,
      attemptedAt: at(0),
    })

    await markNotificationEmailFailed(
      db,
      EMAIL_LATE,
      ORG,
      PROPERTY,
      'transient',
      at(3),
      at(2),
    )
    await expect(
      findNotificationEmailById(db, EMAIL_LATE, ORG, PROPERTY),
    ).resolves.toMatchObject({
      providerRequest: EMAIL_REQUEST,
    })
    await markNotificationEmailSuppressed(
      db,
      EMAIL_LATE,
      ORG,
      PROPERTY,
      'preference_disabled',
      at(4),
    )
    await expect(
      findNotificationEmailById(db, EMAIL_LATE, ORG, PROPERTY),
    ).resolves.toMatchObject({
      status: 'suppressed',
      providerRequest: null,
    })
  })

  it('freezes nothing for a row that can no longer be sent', async () => {
    await markNotificationEmailSuppressed(
      db,
      EMAIL_LATE,
      ORG,
      PROPERTY,
      'preference_disabled',
      NOW,
    )

    await expect(
      freezeProviderRequest(db, EMAIL_LATE, ORG, PROPERTY, EMAIL_REQUEST, NOW),
    ).resolves.toBeNull()
  })

  it('keeps the time of the first provider attempt through every later one', async () => {
    // The provider's 24-hour idempotency window opens at the first attempt.
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)

    await freezeProviderRequest(db, EMAIL_LATE, ORG, PROPERTY, EMAIL_REQUEST, at(0))
    await markNotificationEmailFailed(
      db,
      EMAIL_LATE,
      ORG,
      PROPERTY,
      'transient',
      at(2),
      at(1),
    )
    await freezeProviderRequest(db, EMAIL_LATE, ORG, PROPERTY, EMAIL_REQUEST, at(2))
    await markNotificationEmailAccepted(
      db,
      EMAIL_LATE,
      ORG,
      PROPERTY,
      'resend-first-attempt',
      at(3),
    )

    await expect(
      findNotificationEmailById(db, EMAIL_LATE, ORG, PROPERTY),
    ).resolves.toMatchObject({
      status: 'accepted',
      attemptedAt: at(0),
      acceptedAt: at(3),
    })
  })

  describe('re-keying a batch the provider refused', () => {
    /**
     * How one provider attempt ends: refused before anything was accepted, a
     * rejection that may follow an acceptance, or a worker that died mid-call.
     */
    type AttemptOutcome = 'refused' | 'ambiguous' | 'lost'

    /** One attempt as the digest job makes it: record the start, then settle. */
    const attempt = async (outcome: AttemptOutcome) => {
      await expect(
        startDigestAttempt(db, {
          batchId: BATCH,
          organizationId: ORG,
          userId: USER,
          startedAt: NOW,
        }),
      ).resolves.toBe(true)
      if (outcome === 'lost') return
      await settleDigestBatch(db, {
        batchId: BATCH,
        organizationId: ORG,
        userId: USER,
        expectedContentDigest: digestBatchInput().contentDigest,
        settlement: {
          kind: 'rejected',
          classification: 'transient',
          nextAttemptAt: new Date('2026-08-25T08:01:00.000Z'),
          failedAt: NOW,
          refusedBeforeAcceptance: outcome === 'refused',
        },
      })
    }

    const prepareWithAttempts = async (outcomes: readonly AttemptOutcome[]) => {
      const input = digestBatchInput()
      await prepareDigestBatch(db, input)
      for (const outcome of outcomes) await attempt(outcome)
      return input
    }

    const refuse = (refusedBeforeAcceptance: boolean) =>
      prepareWithAttempts([refusedBeforeAcceptance ? 'refused' : 'ambiguous'])

    const supersede = () =>
      settleDigestBatch(db, {
        batchId: BATCH,
        organizationId: ORG,
        userId: USER,
        expectedContentDigest: 'd'.repeat(64),
        settlement: { kind: 'superseded', detectedAt: NOW },
      })

    it('remembers that the provider refused every attempt', async () => {
      await prepareWithAttempts(['refused', 'refused'])

      await expect(findOpenDigestBatch(db, ORG, USER)).resolves.toMatchObject({
        state: 'retryable',
        everyAttemptRefused: true,
      })
    })

    it('never counts a batch as refused once an earlier attempt may have been accepted', async () => {
      // Accepted at 08:00 with the answer lost, rate-limited at 09:00: the
      // 08:00 message may be in the inbox, so a new key could send it twice.

      await prepareWithAttempts(['ambiguous', 'refused'])

      await expect(findOpenDigestBatch(db, ORG, USER)).resolves.toMatchObject({
        state: 'retryable',
        everyAttemptRefused: false,
      })
      await expect(supersede()).resolves.toBe(false)
    })

    it('treats an attempt that never reported back as possibly accepted', async () => {
      await prepareWithAttempts(['lost', 'refused'])

      await expect(findOpenDigestBatch(db, ORG, USER)).resolves.toMatchObject({
        everyAttemptRefused: false,
      })
      await expect(supersede()).resolves.toBe(false)
    })

    it('starts no attempt on a batch that is no longer open', async () => {
      await refuse(true)
      await supersede()

      await expect(
        startDigestAttempt(db, {
          batchId: BATCH,
          organizationId: ORG,
          userId: USER,
          startedAt: NOW,
        }),
      ).resolves.toBe(false)
    })

    it('retires a refused batch whose content changed and frees its members for a new one', async () => {
      const input = await refuse(true)

      await expect(supersede()).resolves.toBe(true)

      await expect(findOpenDigestBatch(db, ORG, USER)).resolves.toBeNull()
      const [retired] = await db
        .select()
        .from(notificationDigestBatches)
        .where(eq(notificationDigestBatches.id, input.id))
      expect(retired).toMatchObject({ state: 'terminal', outcomeClass: 'superseded' })
      const states = await db
        .select({ id: notificationEmailQueue.id, status: notificationEmailQueue.status })
        .from(notificationEmailQueue)
        .where(eq(notificationEmailQueue.organizationId, ORG))
      expect(new Map(states.map((row) => [row.id, row.status]))).toEqual(
        new Map([
          [EMAIL_A, 'failed'],
          [EMAIL_B, 'failed'],
          [EMAIL_LATE, 'pending'],
        ]),
      )
      const replacement = digestBatchInput(
        notificationDigestBatchId('81000000-0000-4000-8000-000000000023'),
      )
      await expect(prepareDigestBatch(db, replacement)).resolves.toMatchObject({
        created: true,
        batch: { id: replacement.id, sequence: 2 },
      })
    })

    it('retires a refused batch whose rows all dropped, with nothing re-rendered', async () => {
      const input = await refuse(true)

      await expect(
        settleDigestBatch(db, {
          batchId: BATCH,
          organizationId: ORG,
          userId: USER,
          expectedContentDigest: input.contentDigest,
          settlement: { kind: 'superseded', detectedAt: NOW },
        }),
      ).resolves.toBe(true)
      await expect(findOpenDigestBatch(db, ORG, USER)).resolves.toBeNull()
    })

    it('never retires a batch the provider may have accepted', async () => {
      await prepareDigestBatch(db, digestBatchInput())
      await expect(supersede()).resolves.toBe(false)

      await attempt('ambiguous')

      await expect(supersede()).resolves.toBe(false)
      await expect(findOpenDigestBatch(db, ORG, USER)).resolves.toMatchObject({
        id: BATCH,
        state: 'retryable',
        everyAttemptRefused: false,
      })
    })
  })

  describe('the attempt a batch may have been accepted since', () => {
    // The provider's 24-hour idempotency window opens at the first attempt it
    // may have accepted; the digest job closes the batch against that instant.
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)

    const start = (startedAt: Date) =>
      startDigestAttempt(db, {
        batchId: BATCH,
        organizationId: ORG,
        userId: USER,
        startedAt,
      })

    const reject = (failedAt: Date, refusedBeforeAcceptance: boolean) =>
      settleDigestBatch(db, {
        batchId: BATCH,
        organizationId: ORG,
        userId: USER,
        expectedContentDigest: digestBatchInput().contentDigest,
        settlement: {
          kind: 'rejected',
          classification: 'transient',
          nextAttemptAt: null,
          failedAt,
          refusedBeforeAcceptance,
        },
      })

    it('is unset until an attempt starts', async () => {
      await prepareDigestBatch(db, digestBatchInput())

      await expect(findOpenDigestBatch(db, ORG, USER)).resolves.toMatchObject({
        state: 'prepared',
        possiblyAcceptedSince: null,
      })
    })

    it('is the start of an attempt whose worker never reported back', async () => {
      await prepareDigestBatch(db, digestBatchInput())

      await start(at(0))

      await expect(findOpenDigestBatch(db, ORG, USER)).resolves.toMatchObject({
        everyAttemptRefused: false,
        possiblyAcceptedSince: at(0),
      })
    })

    it('stays at the first such attempt through every later attempt and settlement', async () => {
      await prepareDigestBatch(db, digestBatchInput())
      await start(at(0))
      await reject(at(1), false)

      await start(at(60))
      await reject(at(61), true)
      await start(at(120))

      await expect(findOpenDigestBatch(db, ORG, USER)).resolves.toMatchObject({
        everyAttemptRefused: false,
        possiblyAcceptedSince: at(0),
      })
    })

    it('moves to the attempt that follows only refusals, which left nothing to protect', async () => {
      await prepareDigestBatch(db, digestBatchInput())
      await start(at(0))
      await reject(at(1), true)
      await expect(findOpenDigestBatch(db, ORG, USER)).resolves.toMatchObject({
        everyAttemptRefused: true,
        possiblyAcceptedSince: null,
      })

      await start(at(60))

      await expect(findOpenDigestBatch(db, ORG, USER)).resolves.toMatchObject({
        everyAttemptRefused: false,
        possiblyAcceptedSince: at(60),
      })
    })
  })

  it('terminates only the frozen members when provider-visible retry content drifts', async () => {
    const input = digestBatchInput()
    const prepared = await prepareDigestBatch(db, input)

    await expect(
      settleDigestBatch(db, {
        batchId: prepared.batch.id,
        organizationId: ORG,
        userId: USER,
        expectedContentDigest: 'd'.repeat(64),
        settlement: { kind: 'content_mismatch', detectedAt: NOW },
      }),
    ).resolves.toBe(true)

    const states = await db
      .select({ id: notificationEmailQueue.id, status: notificationEmailQueue.status })
      .from(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))
    expect(new Map(states.map((row) => [row.id, row.status]))).toEqual(
      new Map([
        [EMAIL_A, 'suppressed'],
        [EMAIL_B, 'suppressed'],
        [EMAIL_LATE, 'pending'],
      ]),
    )
    await expect(findOpenDigestBatch(db, ORG, USER)).resolves.toBeNull()
    await expect(
      settleDigestBatch(db, {
        batchId: prepared.batch.id,
        organizationId: ORG,
        userId: USER,
        expectedContentDigest: 'd'.repeat(64),
        settlement: { kind: 'content_mismatch', detectedAt: NOW },
      }),
    ).resolves.toBe(false)
  })
})
