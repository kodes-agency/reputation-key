// BQC-7.1 — worker drain budget tests.
//
// Pins the graceful-shutdown contract extracted from src/worker/index.ts:
//   1. happy path — workers close in order, then queues, with the same log
//      messages the pre-extraction inline loop emitted; no timeout;
//   2. a rejecting close is logged and does not stop the sequence;
//   3. a hung close (a job that never finishes makes BullMQ's Worker.close()
//      hang) fires the budget — the drain reports the still-open labels so
//      the caller can exit non-zero instead of stalling the deploy window
//      until the platform's SIGKILL.

import { describe, it, expect, vi } from 'vitest'
import { drainWorkerResources, namedCloseable, type DrainLogger } from './drain'

function makeLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
  } satisfies DrainLogger
}

const closeable = (label: string, close?: () => Promise<void>) => ({
  label,
  close: close ?? (() => Promise.resolve()),
})

const never = () => new Promise<void>(() => {})

describe('drainWorkerResources', () => {
  it('closes workers then queues in order and logs each step (happy path)', async () => {
    const order: string[] = []
    const logger = makeLogger()
    const result = await drainWorkerResources({
      workers: [
        closeable('default', () => Promise.resolve(order.push('worker:default')).then()),
        closeable('background', () =>
          Promise.resolve(order.push('worker:background')).then(),
        ),
      ],
      queues: [
        closeable('default', () => Promise.resolve(order.push('queue:default')).then()),
      ],
      budgetMs: 5_000,
      logger,
    })

    expect(result).toEqual({ timedOut: false, stuck: [] })
    expect(order).toEqual(['worker:default', 'worker:background', 'queue:default'])
    expect(logger.info).toHaveBeenCalledWith(
      { queue: 'default' },
      'Worker drained successfully',
    )
    expect(logger.info).toHaveBeenCalledWith(
      { queue: 'background' },
      'Worker drained successfully',
    )
    expect(logger.info).toHaveBeenCalledWith(
      { queue: 'default' },
      'Queue closed successfully',
    )
  })

  it('logs a rejecting close and continues the sequence', async () => {
    const logger = makeLogger()
    const failure = new Error('redis connection lost')
    const result = await drainWorkerResources({
      workers: [closeable('default', () => Promise.reject(failure))],
      queues: [closeable('quarantine')],
      budgetMs: 5_000,
      logger,
    })

    expect(result).toEqual({ timedOut: false, stuck: [] })
    expect(logger.error).toHaveBeenCalledWith(
      { err: failure, queue: 'default' },
      'Error draining worker',
    )
    expect(logger.info).toHaveBeenCalledWith(
      { queue: 'quarantine' },
      'Queue closed successfully',
    )
  })

  it('times out on a hung close and reports the still-open labels', async () => {
    const logger = makeLogger()
    const laterQueue = vi.fn(() => Promise.resolve())
    const started = performance.now()
    const result = await drainWorkerResources({
      workers: [closeable('default'), closeable('hung', never)],
      queues: [{ label: 'default', close: laterQueue }],
      budgetMs: 50,
      logger,
    })

    expect(result.timedOut).toBe(true)
    // The hung worker is still in-flight; everything after it never started.
    expect(result.stuck).toEqual(['hung', 'default'])
    // The budget resolves the drain even though the hung close never does.
    expect(performance.now() - started).toBeLessThan(5_000)
    expect(logger.info).toHaveBeenCalledWith(
      { queue: 'default' },
      'Worker drained successfully',
    )
  })

  it('does not fire the budget when the sequence finishes within it', async () => {
    const logger = makeLogger()
    const slowButFinite = () => new Promise<void>((resolve) => setTimeout(resolve, 30))
    const result = await drainWorkerResources({
      workers: [closeable('default', slowButFinite)],
      queues: [],
      budgetMs: 5_000,
      logger,
    })

    expect(result).toEqual({ timedOut: false, stuck: [] })
  })

  it('skips undefined lanes silently (unstarted workers/queues never log)', async () => {
    const logger = makeLogger()
    const result = await drainWorkerResources({
      workers: [undefined, closeable('default')],
      queues: [undefined, closeable('quarantine')],
      budgetMs: 5_000,
      logger,
    })

    expect(result).toEqual({ timedOut: false, stuck: [] })
    // Only the real lanes logged — undefined entries produce no output.
    expect(logger.info).toHaveBeenCalledTimes(2)
    expect(logger.info).toHaveBeenCalledWith(
      { queue: 'default' },
      'Worker drained successfully',
    )
    expect(logger.info).toHaveBeenCalledWith(
      { queue: 'quarantine' },
      'Queue closed successfully',
    )
  })
})

// ARC-03-T6 — the worker built the container, so the worker releases it.
describe('drainWorkerResources container release', () => {
  it('releases the container after the workers and before the queues', async () => {
    const order: string[] = []
    const logger = makeLogger()
    const result = await drainWorkerResources({
      workers: [closeable('default', async () => void order.push('worker'))],
      shutdown: { run: async () => void order.push('container') },
      queues: [closeable('default', async () => void order.push('queue'))],
      budgetMs: 5_000,
      logger,
    })

    expect(result).toEqual({ timedOut: false, stuck: [] })
    expect(order).toEqual(['worker', 'container', 'queue'])
    expect(logger.info).toHaveBeenCalledWith(
      { queue: 'container' },
      'Container resources released',
    )
  })

  it('logs a failing release and still closes the queues', async () => {
    const logger = makeLogger()
    const failure = new Error('poller refused to stop')
    const result = await drainWorkerResources({
      workers: [],
      shutdown: { run: () => Promise.reject(failure) },
      queues: [closeable('quarantine')],
      budgetMs: 5_000,
      logger,
    })

    expect(result).toEqual({ timedOut: false, stuck: [] })
    expect(logger.error).toHaveBeenCalledWith(
      { err: failure, queue: 'container' },
      'Error releasing container resources',
    )
    expect(logger.info).toHaveBeenCalledWith(
      { queue: 'quarantine' },
      'Queue closed successfully',
    )
  })

  it('reports the container label as stuck when the release hangs', async () => {
    const logger = makeLogger()
    const result = await drainWorkerResources({
      workers: [],
      shutdown: { run: never },
      queues: [closeable('default')],
      budgetMs: 50,
      logger,
    })

    expect(result.timedOut).toBe(true)
    expect(result.stuck).toEqual(['container', 'default'])
  })
})

describe('namedCloseable', () => {
  it('maps a present resource to a labeled closeable', async () => {
    const close = vi.fn(() => Promise.resolve())
    const entry = namedCloseable('default', { close })

    expect(entry).toBeDefined()
    expect(entry?.label).toBe('default')
    await entry?.close()
    expect(close).toHaveBeenCalledOnce()
  })

  it('returns undefined for an absent resource (no Redis / gated lane)', () => {
    expect(namedCloseable('domain-events', undefined)).toBeUndefined()
  })
})
