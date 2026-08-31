// ARC-03-T6 — the shutdown seam's own contract.
//
// src/composition.lifecycle.test.ts proves the INTEGRATION: a built container
// stops the identity policy poller. What it cannot show is what the seam does
// when a hook misbehaves — the container registers exactly one hook
// (operational-readout.ts, 'identity-policy-store-poller') and nothing in that
// test makes it fail. These are the properties the module's header claims and
// that the integration test would stay green without:
//
//   - hooks run in registration order, one after the other (the comment at the
//     registration site says "registered in release order");
//   - a throwing hook is recorded and skipped, never allowed to abandon the
//     hooks behind it — that is the whole point, since abandoning them leaks
//     the resources this seam exists to release;
//   - `run()` is idempotent under a worker drain racing the web plugin.

import { describe, expect, it, vi } from 'vitest'
import {
  createContainerShutdown,
  type ContainerShutdownHook,
  type ContainerShutdownLogger,
} from './container-lifecycle'

const capturingLogger = () => ({
  error: vi.fn<ContainerShutdownLogger['error']>(),
})

/** A hook that appends its label to `order` when released. */
const recordingHook = (
  order: string[],
  label: string,
  release: () => void | Promise<void> = () => {},
): ContainerShutdownHook =>
  Object.freeze({
    label,
    release: async () => {
      order.push(label)
      await release()
    },
  })

describe('createContainerShutdown — the released capability', () => {
  it('exposes exactly one frozen key, so the surface cannot grow by accretion', () => {
    const shutdown = createContainerShutdown([])

    expect(Object.keys(shutdown)).toEqual(['run'])
    expect(Object.isFrozen(shutdown)).toBe(true)
  })

  it('resolves with no hooks registered', async () => {
    await expect(createContainerShutdown([]).run()).resolves.toBeUndefined()
  })
})

describe('createContainerShutdown — release sequence', () => {
  it('releases hooks in registration order', async () => {
    const order: string[] = []
    const shutdown = createContainerShutdown([
      recordingHook(order, 'first'),
      recordingHook(order, 'second'),
      recordingHook(order, 'third'),
    ])

    await shutdown.run()

    expect(order).toEqual(['first', 'second', 'third'])
  })

  it('awaits each hook before starting the next', async () => {
    // Release order is only meaningful if the hooks are sequenced. A `map` +
    // `Promise.all` rewrite would still satisfy the ordering assertion above
    // (all three push synchronously), but would fail here.
    const order: string[] = []
    let releaseSlow: () => void = () => {}
    const slowSettled = new Promise<void>((resolve) => {
      releaseSlow = resolve
    })
    const shutdown = createContainerShutdown([
      recordingHook(order, 'slow', () => slowSettled),
      recordingHook(order, 'fast'),
    ])

    const running = shutdown.run()
    await Promise.resolve()
    expect(order).toEqual(['slow'])

    releaseSlow()
    await running

    expect(order).toEqual(['slow', 'fast'])
  })
})

describe('createContainerShutdown — a failing hook', () => {
  it('still releases the hooks registered behind a thrower', async () => {
    const order: string[] = []
    const shutdown = createContainerShutdown([
      recordingHook(order, 'before'),
      Object.freeze({
        label: 'thrower',
        release: () => {
          throw new Error('release failed')
        },
      }),
      recordingHook(order, 'after'),
    ])

    await shutdown.run()

    expect(order).toEqual(['before', 'after'])
  })

  it('treats a rejected promise the same as a synchronous throw', async () => {
    const order: string[] = []
    const shutdown = createContainerShutdown([
      Object.freeze({
        label: 'rejector',
        release: () => Promise.reject(new Error('async release failed')),
      }),
      recordingHook(order, 'after'),
    ])

    await shutdown.run()

    expect(order).toEqual(['after'])
  })

  it('resolves rather than rejecting, so a caller cannot skip its own teardown', async () => {
    const shutdown = createContainerShutdown([
      Object.freeze({
        label: 'thrower',
        release: () => {
          throw new Error('release failed')
        },
      }),
    ])

    await expect(shutdown.run()).resolves.toBeUndefined()
  })

  it('records the failure against the hook label', async () => {
    const logger = capturingLogger()
    const err = new Error('release failed')
    const shutdown = createContainerShutdown(
      [
        Object.freeze({
          label: 'identity-policy-store-poller',
          release: () => {
            throw err
          },
        }),
      ],
      logger,
    )

    await shutdown.run()

    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      { err, hook: 'identity-policy-store-poller' },
      'Container shutdown hook failed',
    )
  })

  it('swallows the failure when no logger was supplied', async () => {
    // The logger is optional at the call site, so an unlogged failure must not
    // become an unhandled rejection that takes the shutdown path down with it.
    const order: string[] = []
    const shutdown = createContainerShutdown([
      Object.freeze({
        label: 'thrower',
        release: () => {
          throw new Error('release failed')
        },
      }),
      recordingHook(order, 'after'),
    ])

    await expect(shutdown.run()).resolves.toBeUndefined()
    expect(order).toEqual(['after'])
  })
})

describe('createContainerShutdown — idempotency', () => {
  it('releases once across sequential calls', async () => {
    const release = vi.fn()
    const shutdown = createContainerShutdown([Object.freeze({ label: 'once', release })])

    await shutdown.run()
    await shutdown.run()
    await shutdown.run()

    expect(release).toHaveBeenCalledTimes(1)
  })

  it('hands concurrent callers the same in-flight release', async () => {
    // The worker drain and the web graceful-shutdown plugin can both call this
    // in the same tick; the second caller must await the first release, not
    // start a second one.
    const release = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
    const shutdown = createContainerShutdown([Object.freeze({ label: 'once', release })])

    const first = shutdown.run()
    const second = shutdown.run()

    expect(second).toBe(first)
    await Promise.all([first, second])
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('does not re-run hooks after a failed release settled', async () => {
    const logger = capturingLogger()
    const release = vi.fn(() => {
      throw new Error('release failed')
    })
    const shutdown = createContainerShutdown(
      [Object.freeze({ label: 'thrower', release })],
      logger,
    )

    await shutdown.run()
    await shutdown.run()

    expect(release).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledTimes(1)
  })
})
