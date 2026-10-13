// A frozen digest the provider may already hold is retried under its key only
// while the provider still remembers that key.
//
// The provider forgets an idempotency key after 24 hours. A batch whose first
// attempt may have been accepted (a timeout, a 5xx, a worker lost mid-call)
// used to be re-sent under the same key however much later the next sweep ran:
// after a stop of more than a day the provider no longer knew the key, and the
// manager received the day's digest a second time. Such a batch is now closed
// unsent 23 hours after that attempt started, the horizon immediate mail has.

import { describe, expect, it } from 'vitest'
import type { NotificationDigestBatch } from '../../application/ports/notification-email-repository.port'
import type { NotificationEmail } from '../../domain/notification-types'
import {
  baseDeps,
  entryFor,
  HOUR,
  NOW,
  PROP_A,
  PROP_B,
  runHandler,
} from './digest-job-test-deps'

const MINUTE = 60_000
const RETRY_HORIZON = 23 * HOUR

const failedOnce = (property: string): NotificationEmail => ({
  ...entryFor(property),
  status: 'failed',
  lastErrorClass: 'transient',
  retryCount: 1,
})

/** The batch the 08:00 sweep froze and sent, as that attempt left it. */
async function frozenAt0800(
  outcome: Pick<NotificationDigestBatch, 'everyAttemptRefused' | 'possiblyAcceptedSince'>,
): Promise<NotificationDigestBatch> {
  const first = baseDeps()
  await runHandler(first)
  const batch = (await first.emailRepo.prepareDigestBatch.mock.results[0]!.value).batch
  return { ...batch, state: 'retryable', retryCount: 1, ...outcome }
}

const possiblyAcceptedAt0800 = () =>
  frozenAt0800({ everyAttemptRefused: false, possiblyAcceptedSince: NOW })

const retryAfter = (elapsedMs: number, openBatch: NotificationDigestBatch) =>
  baseDeps({
    now: new Date(NOW.getTime() + elapsedMs),
    openBatch,
    batchEntries: [failedOnce(PROP_A), failedOnce(PROP_B)],
  })

type Deps = ReturnType<typeof baseDeps>

const expectClosedUnsent = (deps: Deps, closedAt: Date) => {
  expect(deps.emailSender.send).not.toHaveBeenCalled()
  expect(deps.emailRepo.startDigestAttempt).not.toHaveBeenCalled()
  expect(deps.emailRepo.settleDigestBatch).toHaveBeenCalledTimes(1)
  expect(deps.emailRepo.settleDigestBatch).toHaveBeenCalledWith(
    expect.objectContaining({
      settlement: {
        kind: 'invalidated',
        reason: 'digest_retry_horizon_passed',
        invalidatedAt: closedAt,
      },
    }),
  )
}

const expectResentUnderFrozenKey = (deps: Deps, batch: NotificationDigestBatch) => {
  expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
  expect(deps.emailSender.send.mock.calls[0]![0].idempotencyKey).toBe(
    batch.providerIdempotencyKey,
  )
}

describe('retrying a frozen digest after a long stop', () => {
  it('closes a possibly-accepted batch unsent 23 hours after that attempt started', async () => {
    const openBatch = await possiblyAcceptedAt0800()
    const deps = retryAfter(RETRY_HORIZON, openBatch)

    await runHandler(deps)

    expectClosedUnsent(deps, new Date(NOW.getTime() + RETRY_HORIZON))
  })

  it('closes it after a stop of more than a day, when the provider has forgotten the key', async () => {
    const openBatch = await possiblyAcceptedAt0800()
    const deps = retryAfter(30 * HOUR, openBatch)

    await runHandler(deps)

    expectClosedUnsent(deps, new Date(NOW.getTime() + 30 * HOUR))
  })

  // The worker died between the provider call and the record of its answer:
  // the batch never left `prepared` and its members are still `pending`, but
  // the attempt was recorded as started, and the provider may hold it.
  it('closes a batch whose worker was lost mid-call, still prepared with pending members', async () => {
    const openBatch: NotificationDigestBatch = {
      ...(await possiblyAcceptedAt0800()),
      state: 'prepared',
      retryCount: 0,
    }
    const deps = baseDeps({
      now: new Date(NOW.getTime() + 30 * HOUR),
      openBatch,
      batchEntries: [entryFor(PROP_A), entryFor(PROP_B)],
    })

    await runHandler(deps)

    expectClosedUnsent(deps, new Date(NOW.getTime() + 30 * HOUR))
  })

  it('still re-sends it under the frozen key a minute before the horizon', async () => {
    const openBatch = await possiblyAcceptedAt0800()
    const deps = retryAfter(RETRY_HORIZON - MINUTE, openBatch)

    await runHandler(deps)

    expectResentUnderFrozenKey(deps, openBatch)
  })

  it('closes it rather than holding it through quiet hours past the horizon', async () => {
    const openBatch = await possiblyAcceptedAt0800()
    // 08:00 the next day, inside a window that would otherwise hold the batch.
    const deps = retryAfter(24 * HOUR, openBatch)
    deps.preferenceRepo.resolveDeliveryWindow.mockResolvedValue({
      quietHoursStart: '07:00',
      quietHoursEnd: '17:00',
      urgentBypassEnabled: false,
    })

    await runHandler(deps)

    expectClosedUnsent(deps, new Date(NOW.getTime() + 24 * HOUR))
  })

  it('keeps retrying a batch the provider refused on every attempt, whose key protects no mail', async () => {
    const openBatch = await frozenAt0800({
      everyAttemptRefused: true,
      possiblyAcceptedSince: null,
    })
    const deps = retryAfter(30 * HOUR, openBatch)

    await runHandler(deps)

    expectResentUnderFrozenKey(deps, openBatch)
    expect(deps.emailRepo.settleDigestBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        settlement: expect.objectContaining({ kind: 'accepted' }),
      }),
    )
  })

  it('sends a batch no attempt was ever started for', async () => {
    const openBatch: NotificationDigestBatch = {
      ...(await frozenAt0800({
        everyAttemptRefused: false,
        possiblyAcceptedSince: null,
      })),
      state: 'prepared',
      retryCount: 0,
    }
    const deps = baseDeps({
      now: new Date(NOW.getTime() + 30 * HOUR),
      openBatch,
      batchEntries: [entryFor(PROP_A), entryFor(PROP_B)],
    })

    await runHandler(deps)

    expectResentUnderFrozenKey(deps, openBatch)
  })
})
