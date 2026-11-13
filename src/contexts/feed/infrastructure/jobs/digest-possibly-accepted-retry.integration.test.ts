// A frozen digest the provider may already hold is re-sent exactly as frozen,
// under its key, when nothing that must not leak has changed.
//
// A 5xx, a timeout or a reset leaves a batch "possibly accepted". Before the
// hourly retry, the recipient may read a line, a colleague may finish the work
// behind one (settlement cancels its queue row), or a repeat event may
// coalesce into one and change its wording. Each of those used to invalidate
// the whole batch, so a first attempt that never reached the provider lost the
// day's digest silently. Re-sending the frozen request under the same key is
// safe: the provider dedupes it. Authorization, standing, preference and
// address changes still close the batch.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { notifications } from '#/shared/db/schema'
import { freezeBatchAtFirstSweep } from './digest-retry-seed'
import {
  openDigestWorld,
  PROP_A,
  PROP_B,
  HOUR,
  NOW,
  type DigestEntry,
  type DigestWorld,
} from './digest-job-test-deps'

let world: DigestWorld
let entryA: DigestEntry
let entryB: DigestEntry

beforeEach(async () => {
  world = await openDigestWorld({ entries: false })
  const reopened = (property: string) =>
    world.entry({
      property,
      type: 'inbox.reopened',
      category: 'workflow_collaboration',
      resourceType: 'inbox_item',
    })
  entryA = await reopened(PROP_A)
  entryB = await reopened(PROP_B)
})

afterEach(async () => {
  await world.rollBack()
})

// The hourly retry: the first sweep's backoff has passed.
const retryDeps = () => world.deps({ now: new Date(NOW.getTime() + HOUR) })

const settledElsewhere = (entry: DigestEntry) =>
  world.setEmail(entry, { status: 'cancelled', suppressionReason: 'work_settled' })

const expectResentUnderFrozenKey = async (
  deps: ReturnType<DigestWorld['deps']>,
  providerIdempotencyKey: string,
) => {
  expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
  expect(deps.emailSender.send.mock.calls[0]![0].idempotencyKey).toBe(
    providerIdempotencyKey,
  )
  for (const entry of [entryA, entryB]) {
    expect(await world.email(entry)).not.toMatchObject({ status: 'suppressed' })
  }
  expect(await world.batches()).toEqual([
    expect.objectContaining({ state: 'accepted', providerIdempotencyKey }),
  ])
}

describe('retrying a digest the provider may already hold', () => {
  it('re-sends it when a line was read in the bell before the retry', async () => {
    const { batch } = await freezeBatchAtFirstSweep(world)
    await world.db
      .update(notifications)
      .set({ status: 'read', readAt: new Date() })
      .where(eq(notifications.id, entryB.notificationId))
    const deps = retryDeps()

    await world.run(deps)

    await expectResentUnderFrozenKey(deps, batch.providerIdempotencyKey)
  })

  it('re-sends it when the work behind a line was settled elsewhere', async () => {
    const { batch } = await freezeBatchAtFirstSweep(world)
    await settledElsewhere(entryB)
    const deps = retryDeps()

    await world.run(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
    expect(deps.emailSender.send.mock.calls[0]![0].idempotencyKey).toBe(
      batch.providerIdempotencyKey,
    )
    expect(await world.batches()).toEqual([
      expect.objectContaining({ state: 'accepted' }),
    ])
  })

  it('re-sends the frozen wording when a repeat event coalesced into a line', async () => {
    const { batch, firstRequest } = await freezeBatchAtFirstSweep(world)
    await world.db
      .update(notifications)
      .set({
        payload: { propertyName: 'Hillcrest', platform: 'portal', guestRating: 2 },
      })
      .where(eq(notifications.id, entryB.notificationId))
    const deps = retryDeps()

    await world.run(deps)

    await expectResentUnderFrozenKey(deps, batch.providerIdempotencyKey)
    expect(deps.emailSender.send.mock.calls[0]![0].html).toBe(firstRequest.html)
  })

  it('closes it when every line was settled elsewhere', async () => {
    const { batch } = await freezeBatchAtFirstSweep(world)
    await settledElsewhere(entryA)
    await settledElsewhere(entryB)
    const deps = retryDeps()

    await world.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(await world.batches()).toEqual([
      expect.objectContaining({ id: batch.id, state: 'terminal' }),
    ])
  })

  it('never sends the frozen request to an address the recipient has left', async () => {
    const { batch } = await freezeBatchAtFirstSweep(world)
    const deps = retryDeps()
    deps.userLookup.getEmail.mockResolvedValue('new-address@example.com')

    await world.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(await world.batches()).toEqual([
      expect.objectContaining({
        id: batch.id,
        state: 'terminal',
        terminalReason: 'provider_request_changed',
      }),
    ])
  })
})
