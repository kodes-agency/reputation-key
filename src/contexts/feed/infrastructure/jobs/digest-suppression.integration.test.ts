// What the digest does with rows it must not mail, and with a provider that
// does not accept the mail, against real PostgreSQL: every row ends settled
// with a visible reason, and a failed attempt leaves the batch to retry.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { notificationPreferences } from '#/shared/db/schema'
import { suppressEmailAddress } from '../../email/notification-email-suppression.server'
import { createResendSenderAnswering, RESEND_NETWORK_FAILURE } from './test-fixtures'
import {
  HOUR,
  NOW,
  openDigestWorld,
  PROP_A,
  PROP_B,
  USER,
  type DigestWorld,
} from './digest-job-test-deps'

const DAY = 24 * HOUR

let world: DigestWorld

beforeEach(async () => {
  world = await openDigestWorld()
})

afterEach(async () => {
  await world.rollBack()
})

const RIVERSIDE = 0

/** Replaces the two seeded rows with an empty queue for tests that seed their own. */
const reopenWorld = async () => {
  await world.rollBack()
  world = await openDigestWorld({ entries: false })
}

describe('digest suppression and failure visibility', () => {
  it('suppresses without sending when the provider already refused the address', async () => {
    const deps = world.deps()
    await suppressEmailAddress(
      world.db,
      deps.emailAddressKeys,
      'manager@example.com',
      'bounced',
      NOW,
    )

    await world.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    for (const entry of world.entries) {
      expect(await world.email(entry)).toMatchObject({ status: 'suppressed' })
    }
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'recipient_bounced' }),
      'Digest entry suppressed',
    )
  })

  it('suppresses and logs when the recipient has no address', async () => {
    const deps = world.deps()
    deps.userLookup.getEmail.mockResolvedValue(null)

    await world.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    for (const entry of world.entries) {
      expect(await world.email(entry)).toMatchObject({ status: 'suppressed' })
    }
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'recipient_unavailable' }),
      'Digest entry suppressed',
    )
  })

  it('logs and keeps every row for a retry when the provider call throws', async () => {
    const deps = world.deps()
    deps.emailSender.send.mockRejectedValue(new Error('socket hang up'))

    await world.run(deps)

    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ entries: 2 }),
      'Daily digest provider call failed',
    )
    expect(await world.batches()).toEqual([
      expect.objectContaining({ state: 'retryable' }),
    ])
    for (const entry of world.entries) {
      expect(await world.email(entry)).not.toMatchObject({ status: 'accepted' })
    }
  })

  it('keeps the batch retryable when the real adapter reports a network failure', async () => {
    // The SDK returns statusCode null for a connectivity blip. Classified
    // permanent, that made the batch terminal and lost the day's digest.
    const deps = world.deps()

    await world.run({
      ...deps,
      emailSender: createResendSenderAnswering(RESEND_NETWORK_FAILURE, () => NOW),
    } as typeof deps)

    const batches = await world.batches()
    expect(batches).toEqual([expect.objectContaining({ state: 'retryable' })])
    for (const entry of world.entries) {
      expect(await world.email(entry)).toMatchObject({
        nextAttemptAt: new Date('2026-07-11T08:00:30.000Z'),
      })
    }
  })

  it('logs a provider rejection instead of treating it as a send', async () => {
    const deps = world.deps()
    deps.emailSender.send.mockResolvedValue({
      kind: 'rejected',
      classification: 'permanent',
      providerCode: 'invalid_recipient',
    })

    await world.run(deps)

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ classification: 'permanent' }),
      'Daily digest rejected by provider',
    )
    for (const entry of world.entries) {
      expect(await world.email(entry)).not.toMatchObject({ status: 'accepted' })
    }
  })

  it('suppresses rows queued long before email was admitted and sends only the fresh ones', async () => {
    await reopenWorld()
    const stale = await world.entry({
      property: PROP_A,
      createdAt: new Date(NOW.getTime() - 30 * DAY),
    })
    const fresh = await world.entry({
      property: PROP_B,
      createdAt: new Date(NOW.getTime() - 20 * HOUR),
    })
    const deps = world.deps()

    await world.run(deps)

    expect(await world.email(stale)).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'stale',
    })
    expect(await world.email(fresh)).toMatchObject({ status: 'accepted' })
    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
    const payload = deps.emailSender.send.mock.calls[0]![0]
    expect(payload.html).toContain('Hillcrest')
    expect(payload.html).not.toContain('Riverside')
  })

  it('drops a Property the recipient lost access to, and still sends the rest', async () => {
    const deps = world.deps()
    deps.isRecipientEligible.mockImplementation(
      async ({ propertyId }) => propertyId !== PROP_A,
    )

    await world.run(deps)

    expect(await world.email(world.entries[RIVERSIDE]!)).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'recipient_ineligible',
    })
    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
    const payload = deps.emailSender.send.mock.calls[0]![0]
    expect(payload.html).toContain('Hillcrest')
    expect(payload.html).not.toContain('Riverside')
  })

  it("shares one standing memo across a recipient's rows", async () => {
    const deps = world.deps()

    await world.run(deps)

    const memos = deps.isRecipientEligible.mock.calls.map((call) => call[1])
    expect(memos).toHaveLength(2)
    expect(memos[0]).toBeDefined()
    expect(memos[1]).toBe(memos[0])
  })

  it('suppresses a preference-disabled row with a visible reason', async () => {
    await world.db
      .update(notificationPreferences)
      .set({ enabled: false })
      .where(eq(notificationPreferences.userId, USER))
    const deps = world.deps()

    await world.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    for (const entry of world.entries) {
      expect(await world.email(entry)).toMatchObject({ status: 'suppressed' })
    }
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'preference_disabled' }),
      'Digest entry suppressed',
    )
  })

  // Goal email is daily only, and a goal preference saved as immediate before
  // that is queued for the digest. Only `enabled` decides at send time, so
  // those rows still go out here.
  it('sends goal rows whose stored preference still says immediate', async () => {
    await world.db
      .update(notificationPreferences)
      .set({ cadence: 'immediate' })
      .where(eq(notificationPreferences.userId, USER))
    const deps = world.deps()

    await world.run(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
    const payload = deps.emailSender.send.mock.calls[0]![0]
    expect(payload.html).toContain('Riverside')
    expect(payload.html).toContain('Hillcrest')
    for (const entry of world.entries) {
      expect(await world.email(entry)).toMatchObject({ status: 'accepted' })
    }
  })
})

// A digest gathers a day of rows. "Follow-up reopened" handled at noon must
// not still be asking for attention in the next morning's digest.
describe('due rows whose work is no longer waiting', () => {
  it('settles a reopen whose Handling Cycle has since closed', async () => {
    await reopenWorld()
    const reopened = (property: string) =>
      world.entry({
        property,
        type: 'inbox.reopened',
        category: 'workflow_collaboration',
        resourceType: 'inbox_item',
        resolvedAt: new Date('2026-07-10T12:00:00.000Z'),
      })
    const entries = [await reopened(PROP_A), await reopened(PROP_B)]
    const deps = world.deps()

    await world.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    for (const entry of entries) {
      expect(await world.email(entry)).toMatchObject({
        status: 'suppressed',
        suppressionReason: 'work_no_longer_waiting',
      })
    }
  })
})

describe('due rows whose notification is gone', () => {
  it('settles rows that can never be sent, so the recipient stops being due', async () => {
    // Skipping them left the recipient due on every hourly run, and 500 of
    // them starved every newer row.
    await reopenWorld()
    const gone = [
      await world.entry({ property: PROP_A, withNotification: false }),
      await world.entry({ property: PROP_B, withNotification: false }),
    ]
    const deps = world.deps()

    await world.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    for (const entry of gone) {
      expect(await world.email(entry)).toMatchObject({
        status: 'suppressed',
        suppressionReason: 'notification_unavailable',
      })
    }
  })

  it('freezes only the rows it could read, and settles the rest', async () => {
    // A frozen member with no notification was marked accepted although it
    // was never sent.
    await reopenWorld()
    const readable = await world.entry({ property: PROP_A })
    const gone = await world.entry({ property: PROP_B, withNotification: false })
    const deps = world.deps()

    await world.run(deps)

    expect(await world.email(gone)).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'notification_unavailable',
    })
    expect(await world.email(readable)).toMatchObject({ status: 'accepted' })
    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
  })
})
