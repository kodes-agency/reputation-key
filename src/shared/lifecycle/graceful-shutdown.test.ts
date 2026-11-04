// Web resource-close tests.
//
// Pins the contract the nitro runtime plugin relies on:
//   1. closers run in order and each close is logged;
//   2. a rejecting close is recorded as an 'error' failure and does not stop
//      the remaining closers (never throws — shutdown must not crash);
//   3. the budget covers the whole sequence: once it expires the rest are
//      skipped and reported as timeouts (the platform SIGKILL is the outer
//      bound for the abandoned resources).

import { describe, it, expect, vi } from 'vitest'
import { closeWebResources, type ShutdownLogger } from './graceful-shutdown'

function makeLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
  } satisfies ShutdownLogger
}

describe('closeWebResources', () => {
  it('closes each resource in order and logs the closes', async () => {
    const order: string[] = []
    const logger = makeLogger()
    const failures = await closeWebResources(
      [
        { name: 'queues', close: () => Promise.resolve(order.push('queues')).then() },
        { name: 'redis', close: () => Promise.resolve(order.push('redis')).then() },
        { name: 'pool', close: () => Promise.resolve(order.push('pool')).then() },
      ],
      { budgetMs: 1_000, logger },
    )

    expect(failures).toEqual([])
    expect(order).toEqual(['queues', 'redis', 'pool'])
    expect(logger.info).toHaveBeenCalledWith(
      { resource: 'pool' },
      'Resource closed during shutdown',
    )
  })

  it('records a rejecting close as an error failure and continues', async () => {
    const logger = makeLogger()
    const failure = new Error('connection reset')
    const second = vi.fn(() => Promise.resolve())
    const failures = await closeWebResources(
      [
        { name: 'redis', close: () => Promise.reject(failure) },
        { name: 'pool', close: second },
      ],
      { budgetMs: 1_000, logger },
    )

    expect(failures).toEqual([{ name: 'redis', reason: 'error' }])
    expect(second).toHaveBeenCalledOnce()
    expect(logger.error).toHaveBeenCalledWith(
      { err: failure, resource: 'redis' },
      'Error closing resource during shutdown',
    )
  })

  it('bounds the whole shutdown and leaves dependencies open after a hung close', async () => {
    const logger = makeLogger()
    const second = vi.fn(() => Promise.resolve())
    const started = performance.now()
    const failures = await closeWebResources(
      [
        { name: 'redis', close: () => new Promise<void>(() => {}) },
        { name: 'pool', close: second },
      ],
      { budgetMs: 50, logger },
    )

    expect(failures).toEqual([
      { name: 'redis', reason: 'timeout' },
      { name: 'pool', reason: 'timeout' },
    ])
    expect(second).not.toHaveBeenCalled()
    expect(performance.now() - started).toBeLessThan(5_000)
  })
})
