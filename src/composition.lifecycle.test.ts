import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeContainer, getContainer } from '#/composition'
import {
  beginContainerDrain,
  createContainerDisposer,
} from './composition/container-lifecycle'

// closeContainer() only ever touches the getContainer() singleton, which lives
// on the process-wide Symbol.for store (the production build bundles
// composition twice). Tests seed the same well-known keys — no test-only export.
const CONTAINER_KEY = Symbol.for('repkey.composition.container')
const LIFECYCLE_KEY = Symbol.for('repkey.composition.lifecycle')

function seed(container: unknown): void {
  if (container === undefined)
    delete (globalThis as Record<symbol, unknown>)[CONTAINER_KEY]
  else (globalThis as Record<symbol, unknown>)[CONTAINER_KEY] = container
}

describe('closeContainer', () => {
  afterEach(() => {
    seed(undefined)
    delete (globalThis as Record<symbol, unknown>)[LIFECYCLE_KEY]
  })

  it('no-ops when the singleton was never built', async () => {
    await expect(closeContainer()).resolves.toBeUndefined()
  })

  it('closes both queues once and resets the store', async () => {
    const jobQueue = { close: vi.fn(async () => undefined) }
    const backgroundQueue = { close: vi.fn(async () => undefined) }
    seed({ jobQueue, backgroundQueue })

    await closeContainer()
    // Store was reset — a second close is a no-op.
    await closeContainer()

    expect(jobQueue.close).toHaveBeenCalledOnce()
    expect(backgroundQueue.close).toHaveBeenCalledOnce()
  })

  it('awaits shutdown before quitting queues and provider-ephemeral Redis', async () => {
    const order: string[] = []
    const shutdown = Object.freeze({
      run: vi.fn(async () => {
        order.push('shutdown')
      }),
    })
    const handles = {
      shutdown,
      jobQueue: { close: vi.fn(async () => void order.push('jobQueue')) },
      backgroundQueue: { close: vi.fn(async () => void order.push('backgroundQueue')) },
      providerEphemeralRedis: {
        quit: vi.fn(async () => void order.push('providerEphemeralRedis')),
      },
    }
    seed({ ...handles, shutdown: createContainerDisposer(handles) })

    await closeContainer()

    expect(shutdown.run).toHaveBeenCalledTimes(1)
    expect(order[0]).toBe('shutdown')
    expect(order.slice(1).sort()).toEqual([
      'backgroundQueue',
      'jobQueue',
      'providerEphemeralRedis',
    ])
  })

  it('cannot rebuild after draining an unbuilt singleton', async () => {
    beginContainerDrain()
    await closeContainer()
    expect(() => getContainer()).toThrow(/draining/)
  })

  it('releases once across concurrent signals and refuses a later rebuild', async () => {
    const release = vi.fn(async () => {})
    seed({ shutdown: { run: release } })
    beginContainerDrain()
    const first = closeContainer()
    expect(closeContainer()).toBe(first)
    await first
    expect(release).toHaveBeenCalledOnce()
    expect(() => getContainer()).toThrow(/draining/)
  })
})
