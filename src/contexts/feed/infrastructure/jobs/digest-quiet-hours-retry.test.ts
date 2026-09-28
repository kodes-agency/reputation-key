// A frozen digest whose retry lands in the recipient's quiet hours waits for
// the window to end under the same key. It used to be deferred like a fresh
// digest: every member was marked delayed, the filter "lost" them all, and a
// batch the provider may already hold was invalidated, so the day's digest
// was suppressed for good.

import { describe, expect, it } from 'vitest'
import type { NotificationDigestBatch } from '../../application/ports/notification-email-repository.port'
import type { NotificationEmail } from '../../domain/notification-types'
import {
  baseDeps,
  entryFor,
  NOW,
  PROP_A,
  PROP_B,
  runHandler,
} from './digest-job-test-deps'

// 09:00:05 UTC on the day the 08:00 attempt failed transiently.
const IN_QUIET_HOURS = new Date(NOW.getTime() + 60 * 60_000 + 5_000)
// 17:00:05 UTC, the first sweep after the window closes.
const AFTER_QUIET_HOURS = new Date(NOW.getTime() + 9 * 60 * 60_000 + 5_000)

const failedOnce = (property: string): NotificationEmail => ({
  ...entryFor(property),
  status: 'failed',
  lastErrorClass: 'transient',
  retryCount: 1,
  nextAttemptAt: new Date(NOW.getTime() + 30_000),
})

async function possiblyAcceptedBatch(): Promise<NotificationDigestBatch> {
  const first = baseDeps()
  await runHandler(first)
  const batch = (await first.emailRepo.prepareDigestBatch.mock.results[0]!.value).batch
  return { ...batch, state: 'retryable', retryCount: 1, everyAttemptRefused: false }
}

function retryAt(now: Date, openBatch: NotificationDigestBatch) {
  const deps = baseDeps({
    now,
    openBatch,
    batchEntries: [failedOnce(PROP_A), failedOnce(PROP_B)],
  })
  deps.preferenceRepo.resolveDeliveryWindow.mockResolvedValue({
    quietHoursStart: '09:00',
    quietHoursEnd: '17:00',
    urgentBypassEnabled: false,
  })
  return deps
}

describe('a frozen digest retry inside quiet hours', () => {
  it('waits, leaving the batch open and its members as they were', async () => {
    const openBatch = await possiblyAcceptedBatch()
    const deps = retryAt(IN_QUIET_HOURS, openBatch)

    await runHandler(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(deps.emailRepo.settleDigestBatch).not.toHaveBeenCalled()
    expect(deps.emailRepo.markSuppressed).not.toHaveBeenCalled()
    expect(deps.emailRepo.markDelayed).not.toHaveBeenCalled()
  })

  it('retries under the frozen key once the window has ended', async () => {
    const openBatch = await possiblyAcceptedBatch()
    const deps = retryAt(AFTER_QUIET_HOURS, openBatch)

    await runHandler(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
    expect(deps.emailSender.send.mock.calls[0]![0].idempotencyKey).toBe(
      openBatch.providerIdempotencyKey,
    )
  })

  it('waits the same way for a batch the provider refused outright', async () => {
    const openBatch = { ...(await possiblyAcceptedBatch()), everyAttemptRefused: true }
    const deps = retryAt(IN_QUIET_HOURS, openBatch)

    await runHandler(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(deps.emailRepo.settleDigestBatch).not.toHaveBeenCalled()
    expect(deps.emailRepo.prepareDigestBatch).not.toHaveBeenCalled()
  })
})
