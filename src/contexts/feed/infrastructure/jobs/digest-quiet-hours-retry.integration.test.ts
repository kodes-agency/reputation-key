// A frozen digest whose retry lands in the recipient's quiet hours waits for
// the window to end under the same key. It used to be deferred like a fresh
// digest: every member was marked delayed, the filter "lost" them all, and a
// batch the provider may already hold was invalidated, so the day's digest
// was suppressed for good.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { notificationDigestBatches } from '#/shared/db/schema'
import { freezeBatchAtFirstSweep, setQuietHours } from './digest-retry-seed'
import { NOW, openDigestWorld, type DigestWorld } from './digest-job-test-deps'

// 09:00:05 UTC on the day the 08:00 attempt failed transiently.
const IN_QUIET_HOURS = new Date(NOW.getTime() + 60 * 60_000 + 5_000)
// 17:00:05 UTC, the first sweep after the window closes.
const AFTER_QUIET_HOURS = new Date(NOW.getTime() + 9 * 60 * 60_000 + 5_000)

let world: DigestWorld

beforeEach(async () => {
  world = await openDigestWorld()
})

afterEach(async () => {
  await world.rollBack()
})

/** The batch the 08:00 sweep froze, with the recipient's window set after it. */
async function frozenBeforeQuietHours(refused = false) {
  const frozen = await freezeBatchAtFirstSweep(world, { refused })
  await setQuietHours(world, '09:00', '17:00')
  return frozen.batch
}

const batchRow = async (id: string) =>
  (
    await world.db
      .select()
      .from(notificationDigestBatches)
      .where(eq(notificationDigestBatches.id, id))
  )[0]!

describe('a frozen digest retry inside quiet hours', () => {
  it('waits, leaving the batch open and its members as they were', async () => {
    const batch = await frozenBeforeQuietHours()
    const deps = world.deps({ now: IN_QUIET_HOURS })

    await world.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(await batchRow(batch.id)).toMatchObject({ state: 'retryable', retryCount: 1 })
    for (const entry of world.entries) {
      expect(await world.email(entry)).toMatchObject({
        status: 'failed',
        suppressionReason: null,
        retryCount: 1,
      })
    }
  })

  it('retries under the frozen key once the window has ended', async () => {
    const batch = await frozenBeforeQuietHours()
    const deps = world.deps({ now: AFTER_QUIET_HOURS })

    await world.run(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
    expect(deps.emailSender.send.mock.calls[0]![0].idempotencyKey).toBe(
      batch.providerIdempotencyKey,
    )
  })

  it('waits the same way for a batch the provider refused outright', async () => {
    const batch = await frozenBeforeQuietHours(true)
    const deps = world.deps({ now: IN_QUIET_HOURS })

    await world.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(await batchRow(batch.id)).toMatchObject({ state: 'retryable' })
    expect(await world.batches()).toHaveLength(1)
  })
})
