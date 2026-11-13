// A frozen immediate email: the request is stored on the queue row before the
// provider is called, and every retry repeats it verbatim under the row's key
// after re-checking the recipient and the work.

import { afterEach, describe, expect, it } from 'vitest'
import { seedPropertyPreference } from './delivery-seed'
import {
  ADDRESS,
  HOUR_MS,
  NOW,
  ORG,
  PROPERTY,
  USER,
  acceptedOutcome,
  openSendWorld,
  type SendWorld,
  type SendWorldOptions,
} from './send-emails-test-deps'
import { suppressEmailAddress } from '../../email/notification-email-suppression.server'
import type { FrozenEmailRequest } from '../../domain/notification-types'

const FROZEN: FrozenEmailRequest = {
  to: ADDRESS,
  subject: 'Frozen subject',
  html: '<p>frozen wording</p>',
  text: 'frozen wording',
  headers: { 'List-Unsubscribe': '<https://app.example.com/u?token=1>' },
  replyTo: 'replies@example.com',
}

let world: SendWorld

afterEach(async () => {
  await world.rollBack()
})

/** A row whose first attempt left a frozen request an hour ago. */
const openAttempted = async (
  overrides: Readonly<{
    retryCount?: number
    attemptedAt?: Date
    frozen?: boolean
    notice?: SendWorldOptions['notice']
  }> = {},
) => {
  const attemptedAt = overrides.attemptedAt ?? new Date(NOW.getTime() - HOUR_MS)
  world = await openSendWorld({
    notice: {
      createdAt: new Date(attemptedAt.getTime() - 30 * 60_000),
      ...overrides.notice,
      email: {
        status: 'failed',
        retryCount: overrides.retryCount ?? 1,
        attemptedAt,
        providerRequest: overrides.frozen === false ? null : FROZEN,
      },
    },
  })
  await world.setEmail({ lastErrorClass: 'transient' })
  return world
}

const sentWithKey = (key: string) => ({
  to: FROZEN.to,
  subject: FROZEN.subject,
  html: FROZEN.html,
  text: FROZEN.text,
  headers: FROZEN.headers,
  replyTo: FROZEN.replyTo,
  idempotencyKey: key,
})

describe('immediate email frozen request', () => {
  it('sends the request it froze, under the row key', async () => {
    world = await openSendWorld()
    const deps = world.deps()
    let frozen: Awaited<ReturnType<SendWorld['email']>>['providerRequest'] = null
    deps.emailSender.send.mockImplementation(async () => {
      frozen = (await world.email()).providerRequest
      return acceptedOutcome()
    })

    await world.run(deps)

    expect(frozen).not.toBeNull()
    expect(deps.emailSender.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: frozen!.to,
        subject: frozen!.subject,
        html: frozen!.html,
        text: frozen!.text,
        headers: frozen!.headers,
        idempotencyKey: world.idempotencyKey,
      }),
    )
  })

  it('sends the stored request when another worker froze first', async () => {
    world = await openSendWorld({ notice: { email: { providerRequest: FROZEN } } })
    const deps = world.deps()

    await world.run(deps)

    expect(deps.emailSender.send).toHaveBeenCalledWith(sentWithKey(world.idempotencyKey))
  })

  it('sends nothing when the row can no longer be sent at the freeze', async () => {
    world = await openSendWorld()
    const deps = world.deps()
    // Settled by another worker after this one read the row.
    deps.userLookup.getEmail.mockImplementation(async () => {
      await world.setEmail({ status: 'cancelled' })
      return ADDRESS
    })

    await world.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(await world.email()).toMatchObject({ status: 'cancelled', acceptedAt: null })
  })

  it('retries verbatim, without rendering again, under the same key', async () => {
    await openAttempted()
    const deps = world.deps()

    await world.run(deps)

    expect(deps.emailSender.send).toHaveBeenCalledWith(sentWithKey(world.idempotencyKey))
    expect(await world.email()).toMatchObject({ status: 'accepted', acceptedAt: NOW })
  })

  describe.each([
    ['settled', { resolvedAt: new Date('2026-01-15T14:00:00.000Z') }],
    ['read in the app', { status: 'read' as const, readAt: NOW }],
  ])('retry of a notice that was %s since the first attempt', (_label, change) => {
    it('suppresses it and sends nothing', async () => {
      await openAttempted({ notice: { type: 'reply.pending_approval' } })
      await world.setNotice(change)
      const deps = world.deps()

      await world.run(deps)

      expect(await world.email()).toMatchObject({
        status: 'suppressed',
        suppressionReason: 'work_no_longer_waiting',
      })
      expect(deps.emailSender.send).not.toHaveBeenCalled()
    })
  })

  it('suppresses a retry whose work was completed', async () => {
    await openAttempted()
    const deps = world.deps()
    deps.workState.isWaiting.mockResolvedValue(false)

    await world.run(deps)

    expect(await world.email()).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'work_no_longer_waiting',
    })
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('keeps an unknown provider outcome retryable with the same request', async () => {
    await openAttempted({ retryCount: 0 })
    const deps = world.deps()
    deps.emailSender.send.mockRejectedValueOnce(new Error('socket hang up'))

    await expect(world.run(deps)).rejects.toThrow('socket hang up')
    expect(await world.email()).toMatchObject({
      status: 'failed',
      lastErrorClass: 'transient',
      failedAt: NOW,
      acceptedAt: null,
    })

    await world.run(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(2)
    const [first, second] = deps.emailSender.send.mock.calls.map(([params]) => params)
    expect(second).toEqual(first)
  })

  it('retries a retry past the old attempt budget until the horizon', async () => {
    await openAttempted({
      retryCount: 9,
      attemptedAt: new Date(NOW.getTime() - 22 * HOUR_MS),
    })
    const deps = world.deps()

    await world.run(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
  })

  it('closes, and does not send, a frozen request past the retry horizon', async () => {
    await openAttempted({ attemptedAt: new Date(NOW.getTime() - 23 * HOUR_MS) })
    const deps = world.deps()

    await world.run(deps)

    expect(await world.email()).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'stale',
    })
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('rechecks the recipient before repeating a frozen request', async () => {
    await openAttempted()
    const deps = world.deps()
    deps.isRecipientEligible.mockResolvedValue(false)

    await world.run(deps)

    expect(await world.email()).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'recipient_ineligible',
    })
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('does not repeat a frozen request to a bounced address', async () => {
    await openAttempted()
    const deps = world.deps()
    await suppressEmailAddress(world.db, deps.emailAddressKeys, ADDRESS, 'bounced', NOW)

    await world.run(deps)

    expect(await world.email()).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'recipient_bounced',
    })
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('does not repeat a frozen request to an address the recipient no longer has', async () => {
    await openAttempted()
    const deps = world.deps()
    deps.userLookup.getEmail.mockResolvedValue('new-address@example.com')

    await world.run(deps)

    expect(await world.email()).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'recipient_address_changed',
    })
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('honours a preference switched off between attempts', async () => {
    await openAttempted()
    await seedPropertyPreference(world.db, {
      userId: USER,
      organizationId: ORG,
      propertyId: PROPERTY,
      category: 'urgent_operational',
      enabled: false,
      cadence: 'immediate',
    })
    const deps = world.deps()

    await world.run(deps)

    expect(await world.email()).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'preference_disabled',
    })
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('closes an attempt made without a frozen request instead of re-rendering it', async () => {
    await openAttempted({ frozen: false })
    const deps = world.deps()

    await world.run(deps)

    expect(await world.email()).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'attempt_not_frozen',
    })
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })
})
