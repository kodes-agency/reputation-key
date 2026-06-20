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

  it('clear() resets both enqueued and processed records', async () => {
    const queue = createInMemoryQueue()
    await queue.add('job', {})
    expect(queue.enqueuedJobs).toHaveLength(1)

    queue.clear()
    expect(queue.enqueuedJobs).toHaveLength(0)
    expect(queue.processedJobs).toHaveLength(0)
  })
})
