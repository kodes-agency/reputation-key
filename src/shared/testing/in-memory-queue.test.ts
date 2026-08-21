// In-memory queue — tests for recording and inline processing.
// Verifies the simulation can exercise the full job pipeline without Redis.

import { describe, it, expect, vi } from 'vitest'
import { createInMemoryQueue } from './in-memory-queue'
import { createJobRegistry } from '#/shared/jobs/registry'

describe('createInMemoryQueue', () => {
  it('records every add() call without a registry', async () => {
    const queue = createInMemoryQueue()
    await queue.add('test-job', { foo: 'bar' })
    await queue.add('other-job', { count: 42 })

    expect(queue.enqueuedJobs).toHaveLength(2)
    expect(queue.enqueuedJobs[0]).toEqual({ name: 'test-job', data: { foo: 'bar' } })
    expect(queue.processedJobs).toHaveLength(0)
  })

  it('processes jobs inline when a registry handler is registered', async () => {
    const registry = createJobRegistry()
    const handler = vi.fn(async () => {})
    registry.register('my-job', handler)

    const queue = createInMemoryQueue({ registry })
    await queue.add('my-job', { key: 'value' })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'my-job', data: { key: 'value' } }),
    )
    expect(queue.processedJobs).toHaveLength(1)
  })

  it('records but does not process jobs with no registered handler', async () => {
    const registry = createJobRegistry()
    const queue = createInMemoryQueue({ registry })
    await queue.add('unregistered-job', {})

    expect(queue.enqueuedJobs).toHaveLength(1)
    expect(queue.processedJobs).toHaveLength(0)
  })

  it('records a throwing handler as a failure, with the error, and rethrows', async () => {
    const registry = createJobRegistry()
    const boom = new Error('handler exploded')
    registry.register('exploding-job', async () => {
      throw boom
    })

    const queue = createInMemoryQueue({ registry })
    await expect(queue.add('exploding-job', { n: 1 })).rejects.toThrow('handler exploded')

    expect(queue.enqueuedJobs).toHaveLength(1)
    // A failed job is NOT processed — that distinction is what lets the
    // no-orphaned-jobs checker tell "handler threw" from "no handler".
    expect(queue.processedJobs).toHaveLength(0)
    expect(queue.failedJobs).toEqual([
      { name: 'exploding-job', data: { n: 1 }, error: boom },
    ])
  })

  it('leaves failedJobs empty when every handler returns', async () => {
    const registry = createJobRegistry()
    registry.register('fine-job', async () => {})
    const queue = createInMemoryQueue({ registry })
    await queue.add('fine-job', {})

    expect(queue.failedJobs).toHaveLength(0)
  })

  it('clear() resets enqueued, processed and failed records', async () => {
    const registry = createJobRegistry()
    registry.register('ok-job', async () => {})
    registry.register('bad-job', async () => {
      throw new Error('nope')
    })
    const queue = createInMemoryQueue({ registry })
    await queue.add('ok-job', {})
    await expect(queue.add('bad-job', {})).rejects.toThrow('nope')
    expect(queue.enqueuedJobs).toHaveLength(2)
    expect(queue.processedJobs).toHaveLength(1)
    expect(queue.failedJobs).toHaveLength(1)

    queue.clear()
    expect(queue.enqueuedJobs).toHaveLength(0)
    expect(queue.processedJobs).toHaveLength(0)
    expect(queue.failedJobs).toHaveLength(0)
  })
})
