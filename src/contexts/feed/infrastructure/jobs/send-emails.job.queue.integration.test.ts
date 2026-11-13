// The immediate-email sender against the real queue: the request is frozen in
// the row before the provider is called, and every retry repeats it verbatim
// under the same key — after an unknown outcome, and after a worker dies on
// either side of the provider call.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { notificationEmailQueue, notifications, properties } from '#/shared/db/schema'
import {
  notificationEmailId,
  notificationId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createNotification } from '../../domain/notification-constructors'
import type { NotificationDeliveryOutcome } from '../../domain/notification-delivery-policy'
import type { EmailSendRequest } from '../../application/ports/email-sender.port'
import { writeNotification } from '../../notify/write.server'
import {
  findDueEmailsByProperty,
  freezeProviderRequest,
} from '../../email/notification-email-queue.server'
import { handlerFor, jobFor, sendEmailsDeps } from './send-emails-test-deps'

const ORG = organizationId('send-emails-integration-org')
const PROPERTY = propertyId('89000000-0000-4000-8000-000000000001')
const NOTICE = '89000000-0000-4000-8000-000000000002'
const EMAIL = '89000000-0000-4000-8000-000000000003'
const RECIPIENT = userId('send-emails-integration-user')
const ADDRESS = 'manager@example.com'
const HOUR_MS = 60 * 60_000

describe.sequential('immediate email sending (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database
  let now: Date

  const clearRows = async () => {
    await db
      .delete(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))
    await db.delete(notifications).where(eq(notifications.organizationId, ORG))
  }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    await clearRows()
    await db.delete(properties).where(eq(properties.organizationId, ORG))
    await db.insert(properties).values({
      id: PROPERTY,
      organizationId: ORG,
      name: 'Sender Hotel',
      slug: 'send-emails-integration',
      timezone: 'UTC',
    })
  })

  beforeEach(async () => {
    await clearRows()
    now = new Date()
    const built = createNotification(
      {
        id: notificationId(NOTICE),
        userId: RECIPIENT,
        organizationId: ORG,
        propertyId: PROPERTY,
        type: 'reply.pending_approval',
        resourceType: 'inbox_item',
        resourceId: '89000000-0000-4000-8000-000000000004',
        eventId: 'send-emails-integration',
      },
      () => now,
    )
    if (built.isErr()) throw built.error
    await writeNotification(db, built.value)
    await db.insert(notificationEmailQueue).values({
      id: EMAIL,
      notificationId: NOTICE,
      userId: RECIPIENT as string,
      organizationId: ORG as string,
      propertyId: PROPERTY as string,
      category: 'urgent_operational',
      cadence: 'immediate',
      status: 'pending',
      priority: 'urgent',
      idempotencyKey: `${NOTICE}:email`,
    })
  })

  afterAll(async () => {
    if (db) {
      await clearRows()
      await db.delete(properties).where(eq(properties.organizationId, ORG))
    }
    await lease?.release()
  })

  const stored = async () => {
    const [row] = await db
      .select()
      .from(notificationEmailQueue)
      .where(eq(notificationEmailQueue.id, EMAIL))
    return row!
  }

  /**
   * The handler on the real queue; the database it is handed can fail the first
   * write that follows the provider call, as a worker killed there would.
   */
  const handlerWith = (
    overrides: Partial<{
      crashAfterProvider: boolean
      send: (request: EmailSendRequest) => Promise<NotificationDeliveryOutcome>
    }> = {},
  ) => {
    const deps = sendEmailsDeps(db, now)
    deps.clock = () => now
    deps.resolvePropertyScope.mockResolvedValue({
      organizationId: ORG as string,
      propertyId: PROPERTY as string,
      timezone: 'UTC',
    })
    const send = overrides.send ?? (async () => accepted('msg-1')())
    const sent: EmailSendRequest[] = []
    const sender = {
      send: vi.fn(async (request: EmailSendRequest) => {
        sent.push(request)
        const outcome = await send(request)
        return (
          outcome ?? { kind: 'accepted', providerMessageId: 'msg-1', acceptedAt: now }
        )
      }),
    }
    let crashed = false
    const failingDb = new Proxy(db, {
      get(target, property) {
        const value = Reflect.get(target, property, target)
        const writesAfterProvider =
          overrides.crashAfterProvider === true &&
          !crashed &&
          sent.length > 0 &&
          property === 'update'
        if (!writesAfterProvider)
          return typeof value === 'function' ? value.bind(target) : value
        crashed = true
        return () => {
          throw new Error('worker killed')
        }
      },
    })
    const wired = { ...deps, db: failingDb, emailSender: sender }
    return {
      deps,
      sent,
      run: () =>
        handlerFor(wired)(
          jobFor(EMAIL, {
            propertyId: PROPERTY as string,
            organizationId: ORG as string,
          }),
        ),
    }
  }

  const accepted = (providerMessageId: string) => async () => ({
    kind: 'accepted' as const,
    providerMessageId,
    acceptedAt: now,
  })

  it('stores the request and the attempt before the provider is called, and clears it once accepted', async () => {
    let duringCall: Awaited<ReturnType<typeof stored>> | undefined
    const { run, sent } = handlerWith({
      send: async () => {
        duringCall = await stored()
        return accepted('msg-1')()
      },
    })

    await run()

    expect(duringCall?.providerRequest).toMatchObject({
      to: ADDRESS,
      subject: sent[0]!.subject,
      html: sent[0]!.html,
    })
    expect(duringCall?.attemptedAt).not.toBeNull()
    const row = await stored()
    expect(row).toMatchObject({ status: 'accepted', providerMessageId: 'msg-1' })
    expect(row.providerRequest).toBeNull()
  })

  it('repeats the frozen request with the same key after an unknown outcome', async () => {
    let calls = 0
    const { run, sent } = handlerWith({
      send: async () => {
        calls += 1
        if (calls === 1) throw new Error('socket hang up')
        return accepted('msg-2')()
      },
    })

    await expect(run()).rejects.toThrow('socket hang up')
    const failed = await stored()
    expect(failed).toMatchObject({ status: 'failed', lastErrorClass: 'transient' })
    expect(failed.providerRequest).not.toBeNull()

    await run()

    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
    expect(sent[1]!.idempotencyKey).toBe(`${NOTICE}:email`)
    expect(await stored()).toMatchObject({
      status: 'accepted',
      providerMessageId: 'msg-2',
    })
  })

  it('sends the frozen request, unrendered again, after a crash before the provider call', async () => {
    await freezeProviderRequest(
      db,
      notificationEmailId(EMAIL),
      ORG,
      PROPERTY,
      {
        to: ADDRESS,
        subject: 'Frozen by the crashed worker',
        html: '<p>frozen</p>',
        text: 'frozen',
        headers: {},
        replyTo: null,
      },
      new Date(now.getTime() - 5 * 60_000),
    )
    const { run, sent, deps } = handlerWith()

    await run()

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      subject: 'Frozen by the crashed worker',
      idempotencyKey: `${NOTICE}:email`,
    })
    expect(deps.resolveOrganizationScope).not.toHaveBeenCalled()
    expect(await stored()).toMatchObject({ status: 'accepted' })
  })

  it('repeats the same request and key when the worker died after the provider accepted', async () => {
    const { run, sent } = handlerWith({ crashAfterProvider: true })

    await expect(run()).rejects.toThrow('worker killed')
    const interrupted = await stored()
    expect(interrupted.providerRequest).not.toBeNull()
    expect(interrupted.acceptedAt).toBeNull()

    await run()

    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
    expect(await stored()).toMatchObject({ status: 'accepted' })
  })

  it('sends one frozen request when two workers race for the same row', async () => {
    const first = handlerWith()
    const second = handlerWith()

    await Promise.all([first.run(), second.run()])

    const all = [...first.sent, ...second.sent]
    expect(all.length).toBeGreaterThanOrEqual(1)
    for (const request of all) expect(request).toEqual(all[0])
    expect(await stored()).toMatchObject({ status: 'accepted' })
  })

  it('does not repeat a frozen request to an address the recipient no longer has', async () => {
    const { run: firstRun } = handlerWith({
      send: async () => {
        throw new Error('timeout')
      },
    })
    await expect(firstRun()).rejects.toThrow('timeout')
    const retry = handlerWith()
    retry.deps.userLookup.getEmail.mockResolvedValue('someone-else@example.com')

    await retry.run()

    expect(retry.sent).toHaveLength(0)
    const row = await stored()
    expect(row).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'recipient_address_changed',
    })
    expect(row.providerRequest).toBeNull()
  })

  it('closes a row past its retry horizon instead of sending under a forgotten key', async () => {
    await freezeProviderRequest(
      db,
      notificationEmailId(EMAIL),
      ORG,
      PROPERTY,
      { to: ADDRESS, subject: 's', html: 'h', text: 't', headers: {}, replyTo: null },
      new Date(now.getTime() - 23 * HOUR_MS - 60_000),
    )
    const { run, sent } = handlerWith()

    await run()

    expect(sent).toHaveLength(0)
    expect(await stored()).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'stale',
    })
  })

  it('closes, rather than re-renders, an attempt made before requests were frozen', async () => {
    await db
      .update(notificationEmailQueue)
      .set({
        attemptedAt: new Date(now.getTime() - HOUR_MS),
        status: 'failed',
        lastErrorClass: 'transient',
      })
      .where(eq(notificationEmailQueue.id, EMAIL))
    const { run, sent } = handlerWith()

    await run()

    expect(sent).toHaveLength(0)
    expect(await stored()).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'attempt_not_frozen',
    })
  })

  it('keeps an immediate row due for retry past five failures, and a daily row not', async () => {
    await db
      .update(notificationEmailQueue)
      .set({
        status: 'failed',
        lastErrorClass: 'transient',
        retryCount: 9,
        nextAttemptAt: new Date(now.getTime() - 60_000),
        attemptedAt: new Date(now.getTime() - 3 * HOUR_MS),
      })
      .where(eq(notificationEmailQueue.id, EMAIL))

    const dueImmediate = await findDueEmailsByProperty(
      db,
      ORG,
      PROPERTY,
      'immediate',
      now,
    )
    expect(dueImmediate.map((row) => row.id)).toEqual([EMAIL])
  })
})
