// A recipient whose digest throws is skipped so the sweep reaches everyone
// else — which also means the job completes and BullMQ records a success. The
// catch is therefore the only place the failure can be reported: logged alone,
// as `{ error: { name } }`, a digest that failed every morning was invisible
// until its rows retired as stale two days later.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  openDigestWorld,
  PROP_A,
  USER,
  USER_2,
  type DigestWorld,
} from './digest-job-test-deps'

const mocks = vi.hoisted(() => ({ capture: vi.fn() }))

vi.mock('#/shared/observability/telemetry', () => ({
  captureObservabilityException: mocks.capture,
}))

const failure = new Error('Digest batch invariant violated: member digest mismatch')

let world: DigestWorld
let deps: ReturnType<DigestWorld['deps']>

beforeEach(async () => {
  mocks.capture.mockClear()
  world = await openDigestWorld({ entries: false })
  deps = world.deps()
  deps.userLookup.getName.mockImplementation(async (user) => {
    if (user === USER) throw failure
    return 'Alex'
  })
})

afterEach(async () => {
  await world.rollBack()
})

describe('a digest recipient that fails', () => {
  it('reaches the error monitor even though the job completes', async () => {
    await world.entry({ property: PROP_A, user: USER })

    await expect(world.run(deps)).resolves.toBeUndefined()

    expect(mocks.capture).toHaveBeenCalledOnce()
    expect(mocks.capture).toHaveBeenCalledWith(failure, {
      source: 'bullmq-job',
      queue: 'background',
      jobName: 'digest-notification',
    })
  })

  it('logs why it failed, not only the error class', async () => {
    const broken = await world.entry({ property: PROP_A, user: USER })
    const next = await world.entry({ property: PROP_A, user: USER_2 })

    await world.run(deps)

    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failureReason: 'Error: Digest batch invariant violated: member digest mismatch',
      }),
      'Daily digest failed for recipient',
    )
    // The sweep still reached the next recipient.
    expect(await world.email(broken)).toMatchObject({ status: 'pending' })
    expect(await world.email(next)).toMatchObject({ status: 'accepted' })
  })
})
