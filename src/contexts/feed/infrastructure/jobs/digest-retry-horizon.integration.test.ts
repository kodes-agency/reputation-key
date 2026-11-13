// A frozen digest the provider may already hold is retried under its key only
// while the provider still remembers that key.
//
// The provider forgets an idempotency key after 24 hours. A batch whose first
// attempt may have been accepted (a timeout, a 5xx, a worker lost mid-call)
// used to be re-sent under the same key however much later the next sweep ran:
// after a stop of more than a day the provider no longer knew the key, and the
// manager received the day's digest a second time. Such a batch is now closed
// unsent 23 hours after that attempt started, the horizon immediate mail has.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  freezeBatchAtFirstSweep,
  loseWorkerMidCall,
  neverStarted,
  setQuietHours,
} from './digest-retry-seed'
import { HOUR, NOW, openDigestWorld, type DigestWorld } from './digest-job-test-deps'

const MINUTE = 60_000
const RETRY_HORIZON = 23 * HOUR

let world: DigestWorld

beforeEach(async () => {
  world = await openDigestWorld()
})

afterEach(async () => {
  await world.rollBack()
})

const retryAfter = (elapsedMs: number) =>
  world.deps({ now: new Date(NOW.getTime() + elapsedMs) })

const expectClosedUnsent = async (
  deps: ReturnType<DigestWorld['deps']>,
  batchId: string,
  closedAt: Date,
) => {
  expect(deps.emailSender.send).not.toHaveBeenCalled()
  const batches = await world.batches()
  expect(batches).toHaveLength(1)
  expect(batches[0]).toMatchObject({
    id: batchId,
    state: 'terminal',
    outcomeClass: 'invalidated',
    terminalReason: 'digest_retry_horizon_passed',
    failedAt: closedAt,
    // The attempt that opened the provider's window is the one from 08:00.
    attemptedAt: NOW,
  })
  for (const entry of world.entries) {
    expect(await world.email(entry)).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'digest_retry_horizon_passed',
    })
  }
}

const expectResentUnderFrozenKey = async (
  deps: ReturnType<DigestWorld['deps']>,
  providerIdempotencyKey: string,
) => {
  expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
  expect(deps.emailSender.send.mock.calls[0]![0].idempotencyKey).toBe(
    providerIdempotencyKey,
  )
  expect(await world.batches()).toEqual([
    expect.objectContaining({ state: 'accepted', providerIdempotencyKey }),
  ])
}

describe('retrying a frozen digest after a long stop', () => {
  it('closes a possibly-accepted batch unsent 23 hours after that attempt started', async () => {
    const { batch } = await freezeBatchAtFirstSweep(world)
    const deps = retryAfter(RETRY_HORIZON)

    await world.run(deps)

    await expectClosedUnsent(deps, batch.id, new Date(NOW.getTime() + RETRY_HORIZON))
  })

  it('closes it after a stop of more than a day, when the provider has forgotten the key', async () => {
    const { batch } = await freezeBatchAtFirstSweep(world)
    const deps = retryAfter(30 * HOUR)

    await world.run(deps)

    await expectClosedUnsent(deps, batch.id, new Date(NOW.getTime() + 30 * HOUR))
  })

  // The worker died between the provider call and the record of its answer:
  // the batch never left `prepared` and its members are still `pending`, but
  // the attempt was recorded as started, and the provider may hold it.
  it('closes a batch whose worker was lost mid-call, still prepared with pending members', async () => {
    const { batch } = await freezeBatchAtFirstSweep(world)
    await loseWorkerMidCall(world, batch.id)
    const deps = retryAfter(30 * HOUR)

    await world.run(deps)

    await expectClosedUnsent(deps, batch.id, new Date(NOW.getTime() + 30 * HOUR))
  })

  it('still re-sends it under the frozen key a minute before the horizon', async () => {
    const { batch } = await freezeBatchAtFirstSweep(world)
    const deps = retryAfter(RETRY_HORIZON - MINUTE)

    await world.run(deps)

    await expectResentUnderFrozenKey(deps, batch.providerIdempotencyKey)
  })

  it('closes it rather than holding it through quiet hours past the horizon', async () => {
    const { batch } = await freezeBatchAtFirstSweep(world)
    // 08:00 the next day, inside a window that would otherwise hold the batch.
    await setQuietHours(world, '07:00', '17:00')
    const deps = retryAfter(24 * HOUR)

    await world.run(deps)

    await expectClosedUnsent(deps, batch.id, new Date(NOW.getTime() + 24 * HOUR))
  })

  it('keeps retrying a batch the provider refused on every attempt, whose key protects no mail', async () => {
    const { batch } = await freezeBatchAtFirstSweep(world, { refused: true })
    const deps = retryAfter(30 * HOUR)

    await world.run(deps)

    await expectResentUnderFrozenKey(deps, batch.providerIdempotencyKey)
  })

  it('sends a batch no attempt was ever started for', async () => {
    const { batch } = await freezeBatchAtFirstSweep(world)
    await neverStarted(world, batch.id)
    const deps = retryAfter(30 * HOUR)

    await world.run(deps)

    await expectResentUnderFrozenKey(deps, batch.providerIdempotencyKey)
  })
})
