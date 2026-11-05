// The container disposer and process lifecycle contract.
//
// src/composition.lifecycle.test.ts proves the integration ordering. These tests
// cover the reusable seam's behaviour:
//   - hooks release in reverse acquisition order, one after the other;
//   - a failing hook is recorded and never abandons the hooks behind it, since
//     abandoning them leaks the resources this seam exists to release, and the
//     failure is reported once the rest have run so a caller can exit nonzero;
//   - `run()` is idempotent under a worker drain racing the web plugin;
//   - once draining or failed, nothing builds another container.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createContainerShutdown,
  createContainerDisposer,
  assertContainerCanBuild,
  beginContainerDrain,
  containerLifecycleState,
  markContainerFailed,
  markContainerReady,
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
  it('releases hooks in reverse acquisition order', async () => {
    const order: string[] = []
    const shutdown = createContainerShutdown([
      recordingHook(order, 'first'),
      recordingHook(order, 'second'),
      recordingHook(order, 'third'),
    ])

    await shutdown.run()

    expect(order).toEqual(['third', 'second', 'first'])
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
      recordingHook(order, 'fast'),
      recordingHook(order, 'slow', () => slowSettled),
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

    await expect(shutdown.run()).rejects.toBeInstanceOf(AggregateError)

    expect(order).toEqual(['after', 'before'])
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

    await expect(shutdown.run()).rejects.toBeInstanceOf(AggregateError)

    expect(order).toEqual(['after'])
  })

  it('rejects after completing teardown so the process can exit nonzero', async () => {
    const shutdown = createContainerShutdown([
      Object.freeze({
        label: 'thrower',
        release: () => {
          throw new Error('release failed')
        },
      }),
    ])

    await expect(shutdown.run()).rejects.toBeInstanceOf(AggregateError)
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

    await expect(shutdown.run()).rejects.toBeInstanceOf(AggregateError)

    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      { err, hook: 'identity-policy-store-poller' },
      'Container shutdown hook failed',
    )
  })

  it('reports failure even when no logger was supplied', async () => {
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

    await expect(shutdown.run()).rejects.toBeInstanceOf(AggregateError)
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

    await expect(shutdown.run()).rejects.toBeInstanceOf(AggregateError)
    await expect(shutdown.run()).rejects.toBeInstanceOf(AggregateError)

    expect(release).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledTimes(1)
  })
})

const LIFECYCLE_KEY = Symbol.for('repkey.composition.lifecycle')
afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[LIFECYCLE_KEY]
})

describe('process lifecycle', () => {
  it('never rebuilds after draining starts, including an unbuilt process', () => {
    expect(containerLifecycleState()).toBe('starting')
    beginContainerDrain()
    expect(() => assertContainerCanBuild()).toThrow(/draining/)
    markContainerReady()
    expect(containerLifecycleState()).toBe('draining')
  })

  it('remembers a failed build with its cause and never retries it', () => {
    const cause = new Error('a key group is missing')
    markContainerFailed(cause)
    markContainerReady()
    beginContainerDrain()

    expect(containerLifecycleState()).toBe('failed')
    expect(() => assertContainerCanBuild()).toThrow(
      expect.objectContaining({ message: 'Container is failed', cause }),
    )
  })
})

describe('complete container disposal', () => {
  it('closes owned handles in reverse acquisition order before shared transports', async () => {
    const order: string[] = []
    await createContainerDisposer({
      jobQueue: {
        close: async () => {
          order.push('default')
        },
      },
      backgroundQueue: {
        close: async () => {
          order.push('background')
        },
      },
      opsQueues: {
        domainEvents: {
          close: async () => {
            order.push('domain-events')
          },
        },
      },
      providerEphemeralRedis: {
        quit: async () => {
          order.push('provider')
        },
      },
      shutdown: {
        run: async () => {
          order.push('owned')
        },
      },
    }).run()
    expect(order).toEqual(['owned', 'provider', 'domain-events', 'background', 'default'])
  })
})
