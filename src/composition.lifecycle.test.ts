import {
  beginContainerDrain,
  createContainerDisposer,
} from './composition/container-lifecycle'
// Container shutdown ordering remains load-bearing even though static policy
// starts no background poller.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeContainer, getContainer } from '#/composition'

// closeContainer() only ever touches the getContainer() singleton, which lives
// on the process-wide Symbol.for store (the production build bundles
// composition twice). Tests seed the same well-known key — no test-only export.
describe('closeContainer runs the container shutdown first (ARC-03-T6)', () => {
  const CONTAINER_KEY = Symbol.for('repkey.composition.container')

  function seed(container: unknown): void {
    if (container === undefined)
      delete (globalThis as Record<symbol, unknown>)[CONTAINER_KEY]
    else (globalThis as Record<symbol, unknown>)[CONTAINER_KEY] = container
  }

  afterEach(() => {
    seed(undefined)
    delete (globalThis as Record<symbol, unknown>)[
      Symbol.for('repkey.composition.lifecycle')
    ]
  })

  it('no-ops when the singleton was never built', async () => {
    seed(undefined)
    await expect(closeContainer()).resolves.toBeUndefined()
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
})

describe('draining singleton', () => {
  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[
      Symbol.for('repkey.composition.lifecycle')
    ]
    delete (globalThis as Record<symbol, unknown>)[
      Symbol.for('repkey.composition.container')
    ]
  })
  it('cannot rebuild after draining an unbuilt singleton', async () => {
    beginContainerDrain()
    await closeContainer()
    expect(() => getContainer()).toThrow(/draining/)
  })
  it('releases once across concurrent signals and refuses a later rebuild', async () => {
    const release = vi.fn(async () => {})
    ;(globalThis as Record<symbol, unknown>)[Symbol.for('repkey.composition.container')] =
      { shutdown: { run: release } }
    beginContainerDrain()
    const first = closeContainer()
    expect(closeContainer()).toBe(first)
    await first
    expect(release).toHaveBeenCalledOnce()
    expect(() => getContainer()).toThrow(/draining/)
  })
})
