// The Resend delivery-event handler against real PostgreSQL: what each
// provider event does to the queue rows, the recipient's other queued mail and
// the durable address list. Each test runs in a transaction that is rolled back.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { notificationEmailQueue, notificationEmailSuppressions } from '#/shared/db/schema'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { seedProperty } from '#/shared/db/testing/notification-test-db'
import { userId } from '#/shared/domain/ids'
import { createFakeJobLogger } from '../jobs/test-fixtures'
import { readEmail, seedNotice, stableUuid, emailIdOf } from '../jobs/delivery-seed'
import {
  hasAppliedProviderEvent,
  isEmailAddressSuppressed,
  suppressEmailAddress,
} from '../../email/notification-email-suppression.server'
import {
  applyResendEvent,
  createResendEventHandler,
  type ResendEventDeps,
  type ResendEventInput,
} from './resend-event-handler'

const OCCURRED_AT = new Date('2026-08-21T09:05:00Z')
const BEFORE = new Date('2026-08-21T08:00:00Z')
const ORG = 'resend-handler-org'
const PROPERTY = stableUuid('resend-handler', 'property')
const KEYS = { emailAddressKey: 'resend-event-handler-test-key-0000001' }
const PROVIDER_ID = 'prov-1'
const addressOf = (user: string) => `${user}@example.com`

let held: HeldTransaction | undefined

afterEach(async () => {
  await held?.rollBack()
  held = undefined
})

type Row = Readonly<{ status?: string; providerMessageId?: string }>

/** A property for the rows to belong to, and the handler's own dependencies. */
async function openWorld() {
  held = await holdTransaction()
  const db: Database = held.db
  await seedProperty(db, { id: PROPERTY, organizationId: ORG, name: 'Riverside Hotel' })
  const logger = createFakeJobLogger()
  const getEmail = vi.fn(async (user: string): Promise<string | null> => addressOf(user))
  const deps: ResendEventDeps = {
    db,
    emailAddressKeys: KEYS,
    userLookup: { getEmail },
    logger,
  }

  /** A queue row for a user; by default one the provider has accepted. */
  const queue = async (name: string, user: string, row: Row = {}) => {
    const status = row.status ?? 'accepted'
    await seedNotice(db, {
      name: `resend-handler-${name}`,
      organizationId: ORG,
      userId: user,
      propertyId: PROPERTY,
      createdAt: BEFORE,
      email: { cadence: 'immediate', status },
    })
    const id = emailIdOf(`resend-handler-${name}`)
    const providerMessageId =
      row.providerMessageId ?? (status === 'pending' ? undefined : PROVIDER_ID)
    if (providerMessageId !== undefined) {
      await db
        .update(notificationEmailQueue)
        .set({ providerMessageId })
        .where(eq(notificationEmailQueue.id, id))
    }
    return id
  }
  const read = (name: string) => readEmail(db, emailIdOf(`resend-handler-${name}`))
  const isSuppressed = (user: string) =>
    isEmailAddressSuppressed(db, KEYS, addressOf(user))
  /** The reasons of the refused addresses these tests recorded, by their event time. */
  const recordedReasons = async () =>
    (
      await db
        .select({ reason: notificationEmailSuppressions.reason })
        .from(notificationEmailSuppressions)
        .where(eq(notificationEmailSuppressions.updatedAt, OCCURRED_AT))
    )
      .map((row) => row.reason)
      .sort()

  const event = (
    type: string,
    bounceType?: string,
    providerMessageId = PROVIDER_ID,
  ): ResendEventInput => ({
    type,
    providerMessageId,
    occurredAt: OCCURRED_AT,
    eventId: 'msg_2abc',
    ...(bounceType === undefined ? {} : { bounceType }),
  })
  const run = (type: string, bounceType?: string) =>
    applyResendEvent(deps, event(type, bounceType))

  return {
    db,
    deps,
    logger,
    getEmail,
    queue,
    read,
    isSuppressed,
    recordedReasons,
    event,
    run,
  }
}

describe('resend delivery event handler against real PostgreSQL', () => {
  it('records a delivery without suppressing the recipient', async () => {
    const w = await openWorld()
    await w.queue('sent', 'user-1')
    await w.queue('later', 'user-1', { status: 'pending' })

    const result = await w.run('email.delivered')

    expect(await w.read('sent')).toMatchObject({
      status: 'delivered',
      providerState: 'delivered',
      deliveredAt: OCCURRED_AT,
    })
    expect(await w.read('later')).toMatchObject({
      status: 'pending',
      suppressionReason: null,
    })
    expect(await w.isSuppressed('user-1')).toBe(false)
    expect(result).toEqual({ applied: true, rows: 1, suppressed: 0 })
  })

  it('suppresses the recipient on a bounce so we stop mailing a dead address', async () => {
    const w = await openWorld()
    await w.queue('sent', 'user-1')
    await w.queue('later', 'user-1', { status: 'pending' })

    const result = await w.run('email.bounced')

    expect(await w.read('sent')).toMatchObject({
      status: 'bounced',
      providerState: 'bounced',
      bouncedAt: OCCURRED_AT,
    })
    expect(await w.read('later')).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'provider_bounced',
    })
    expect(result).toEqual({ applied: true, rows: 1, suppressed: 1 })
  })

  it('keeps a permanent bounce, keyed by address, beyond the queue rows retention deletes', async () => {
    const w = await openWorld()
    await w.queue('sent', 'user-1')

    await w.run('email.bounced', 'Permanent')
    await w.db
      .delete(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))

    expect(w.getEmail).toHaveBeenCalledWith(userId('user-1'))
    expect(await w.isSuppressed('user-1')).toBe(true)
    expect(await w.recordedReasons()).toEqual(['bounced'])
  })

  it.each(['Transient', 'Undetermined'])(
    'records a %s bounce without suppressing the recipient',
    async (bounceType) => {
      // A full mailbox must not stop every notice, mandatory ones included.
      const w = await openWorld()
      await w.queue('sent', 'user-1')
      await w.queue('later', 'user-1', { status: 'pending' })

      const result = await w.run('email.bounced', bounceType)

      expect(await w.read('sent')).toMatchObject({
        status: 'bounced',
        providerState: 'bounced',
      })
      expect(await w.read('later')).toMatchObject({
        status: 'pending',
        suppressionReason: null,
      })
      expect(await w.isSuppressed('user-1')).toBe(false)
      expect(result).toEqual({ applied: true, rows: 1, suppressed: 0 })
    },
  )

  it('keeps a complaint and a provider suppression by address too', async () => {
    const w = await openWorld()
    await w.queue('complained', 'user-1', { providerMessageId: 'prov-c' })
    await w.queue('suppressed', 'user-2', { providerMessageId: 'prov-s' })

    await applyResendEvent(w.deps, w.event('email.complained', undefined, 'prov-c'))
    expect(await w.recordedReasons()).toEqual(['complained'])
    await applyResendEvent(w.deps, w.event('email.suppressed', undefined, 'prov-s'))

    expect(await w.isSuppressed('user-1')).toBe(true)
    expect(await w.isSuppressed('user-2')).toBe(true)
    expect(await w.recordedReasons()).toEqual(['complained', 'suppressed'])
  })

  it('suppresses the recipient on a spam complaint', async () => {
    const w = await openWorld()
    await w.queue('sent', 'user-1')
    await w.queue('later', 'user-1', { status: 'pending' })

    await w.run('email.complained')

    expect(await w.read('sent')).toMatchObject({
      status: 'complained',
      providerState: 'complained',
    })
    expect(await w.read('later')).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'provider_complained',
    })
  })

  it('suppresses the recipient when the provider suppressed the message', async () => {
    // Resend accepts the send (200, id stored), then drops it because the
    // address is on its suppression list and says so only by this webhook.
    const w = await openWorld()
    await w.queue('sent', 'user-1')
    await w.queue('later', 'user-1', { status: 'pending' })

    const result = await w.run('email.suppressed')

    expect(await w.read('sent')).toMatchObject({
      status: 'suppressed',
      providerState: 'suppressed',
    })
    expect(await w.read('later')).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'provider_suppressed',
    })
    expect(result).toEqual({ applied: true, rows: 1, suppressed: 1 })
  })

  it('records a failure after acceptance as terminal, loudly, without suppressing the address', async () => {
    const w = await openWorld()
    await w.queue('sent', 'user-1')
    await w.queue('later', 'user-1', { status: 'pending' })

    const result = await w.run('email.failed')

    expect(await w.read('sent')).toMatchObject({
      status: 'failed',
      providerState: 'failed',
      failedAt: OCCURRED_AT,
      lastErrorClass: 'permanent',
    })
    expect(await w.read('later')).toMatchObject({
      status: 'pending',
      suppressionReason: null,
    })
    expect(await w.isSuppressed('user-1')).toBe(false)
    expect(result).toEqual({ applied: true, rows: 1, suppressed: 0 })
    expect(w.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryState: 'failed', rows: 1 }),
      'Email failed at the provider after it was accepted',
    )
  })

  it('records a provider delivery delay without suppressing anyone', async () => {
    const w = await openWorld()
    await w.queue('sent', 'user-1')
    await w.queue('later', 'user-1', { status: 'pending' })

    const result = await w.run('email.delivery_delayed')

    expect(await w.read('sent')).toMatchObject({
      status: 'accepted',
      providerState: 'delivery_delayed',
    })
    expect(await w.read('later')).toMatchObject({ status: 'pending' })
    expect(await w.isSuppressed('user-1')).toBe(false)
    expect(result).toEqual({ applied: true, rows: 1, suppressed: 0 })
  })

  it('cascades once per recipient even when the event moves several rows', async () => {
    const w = await openWorld()
    await w.queue('sent-1a', 'user-1')
    await w.queue('sent-1b', 'user-1')
    await w.queue('sent-2', 'user-2')
    await w.queue('later-1a', 'user-1', { status: 'pending' })
    await w.queue('later-1b', 'user-1', { status: 'pending' })
    await w.queue('later-2', 'user-2', { status: 'pending' })

    const result = await w.run('email.bounced')

    expect(w.getEmail).toHaveBeenCalledTimes(2)
    for (const name of ['later-1a', 'later-1b', 'later-2']) {
      expect(await w.read(name)).toMatchObject({
        status: 'suppressed',
        suppressionReason: 'provider_bounced',
      })
    }
    expect(result).toEqual({ applied: true, rows: 3, suppressed: 3 })
  })

  it('logs a bounce at error level — an invisible bounce is the original defect', async () => {
    const w = await openWorld()
    await w.queue('sent', 'user-1')
    await w.queue('later', 'user-1', { status: 'pending' })

    await w.run('email.bounced')

    expect(w.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryState: 'bounced', suppressed: 1 }),
      expect.stringContaining('undeliverable'),
    )
  })

  it('ignores engagement events without touching the queue', async () => {
    const w = await openWorld()
    await w.queue('sent', 'user-1')

    for (const type of ['email.sent', 'email.opened', 'email.clicked']) {
      const result = await w.run(type)
      expect(result.reason).toBe('ignored_event_type')
    }

    expect(await w.read('sent')).toMatchObject({
      status: 'accepted',
      providerState: null,
      updatedAt: BEFORE,
    })
  })

  it('warns rather than silently no-ops when the event matches no row', async () => {
    const w = await openWorld()
    await w.queue('later', 'user-1', { status: 'pending' })

    const result = await w.run('email.delivered')

    expect(result).toEqual({
      applied: false,
      rows: 0,
      suppressed: 0,
      reason: 'unknown_message',
    })
    expect(w.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryState: 'delivered' }),
      expect.stringContaining('matched no queue row'),
    )
    expect(await w.read('later')).toMatchObject({
      status: 'pending',
      suppressionReason: null,
    })
  })

  describe('remembering a delivery', () => {
    it('remembers an applied event', async () => {
      const w = await openWorld()
      await w.queue('sent', 'user-1')

      await createResendEventHandler(w.deps)(w.event('email.delivered'))

      expect(await hasAppliedProviderEvent(w.db, 'msg_2abc')).toBe(true)
    })

    it('does not remember an event that matched no queue row, so a replay is applied', async () => {
      const w = await openWorld()
      const handler = createResendEventHandler(w.deps)

      const result = await handler(w.event('email.delivered'))
      expect(await hasAppliedProviderEvent(w.db, 'msg_2abc')).toBe(false)
      await w.queue('sent', 'user-1')
      const replay = await handler(w.event('email.delivered'))

      expect(result.reason).toBe('unknown_message')
      expect(replay).toEqual({ applied: true, rows: 1, suppressed: 0 })
      expect(await w.read('sent')).toMatchObject({ status: 'delivered' })
    })
  })

  describe('a retried event whose row already moved', () => {
    // The status change commits before the suppression is written. When the
    // suppression then fails, the provider retries, but the row is already
    // `complained`: nothing moves, and the suppression must still be written.
    it('writes the suppression the first delivery failed to record', async () => {
      const w = await openWorld()
      await w.queue('sent', 'user-1', { status: 'complained' })
      await w.queue('later', 'user-1', { status: 'pending' })

      const result = await w.run('email.complained')

      expect(await w.isSuppressed('user-1')).toBe(true)
      expect(await w.recordedReasons()).toEqual(['complained'])
      expect(await w.read('later')).toMatchObject({
        status: 'suppressed',
        suppressionReason: 'provider_complained',
      })
      expect(result).toEqual({ applied: true, rows: 0, suppressed: 1 })
    })

    it('still ends only the message for a transient bounce', async () => {
      const w = await openWorld()
      await w.queue('sent', 'user-1', { status: 'bounced' })
      await w.queue('later', 'user-1', { status: 'pending' })

      const result = await w.run('email.bounced', 'Transient')

      expect(await w.isSuppressed('user-1')).toBe(false)
      expect(await w.read('later')).toMatchObject({ status: 'pending' })
      expect(result.reason).toBe('unknown_message')
    })

    it('reports a message that is not ours as unknown', async () => {
      const w = await openWorld()
      await w.queue('other', 'user-1', { providerMessageId: 'prov-other' })

      const result = await w.run('email.bounced', 'Permanent')

      expect(await w.isSuppressed('user-1')).toBe(false)
      expect(await w.read('other')).toMatchObject({ status: 'accepted' })
      expect(result.reason).toBe('unknown_message')
    })
  })

  describe("the provider's own suppression list", () => {
    const listEvent = (
      type: 'suppression.added' | 'suppression.removed',
      origin?: string,
    ): ResendEventInput => ({
      type,
      address: 'manager@example.com',
      ...(origin === undefined ? {} : { origin }),
      occurredAt: OCCURRED_AT,
      eventId: 'msg_list',
    })
    const managerSuppressed = (db: Database) =>
      isEmailAddressSuppressed(db, KEYS, 'manager@example.com')

    it('lifts our suppression when the provider removes the address', async () => {
      const w = await openWorld()
      await suppressEmailAddress(w.db, KEYS, 'manager@example.com', 'bounced', BEFORE)

      const result = await applyResendEvent(
        w.deps,
        listEvent('suppression.removed', 'bounce'),
      )

      expect(await managerSuppressed(w.db)).toBe(false)
      expect(result).toEqual({ applied: true, rows: 0, suppressed: 0 })
    })

    it('records an address the provider added, with the reason it gives', async () => {
      const w = await openWorld()
      await w.queue('sent', 'user-1')
      const reasons: string[] = []

      for (const origin of ['complaint', 'bounce', 'manual']) {
        await applyResendEvent(w.deps, listEvent('suppression.added', origin))
        reasons.push(...(await w.recordedReasons()))
      }

      expect(reasons).toEqual(['complained', 'bounced', 'suppressed'])
      expect(await managerSuppressed(w.db)).toBe(true)
      expect(await w.read('sent')).toMatchObject({
        status: 'accepted',
        providerState: null,
      })
    })

    it('never writes the address to a log', async () => {
      const w = await openWorld()

      await applyResendEvent(w.deps, listEvent('suppression.removed'))

      const logged = JSON.stringify([
        w.logger.info.mock.calls,
        w.logger.warn.mock.calls,
        w.logger.error.mock.calls,
      ])
      expect(logged).not.toContain('manager@example.com')
    })
  })
})
