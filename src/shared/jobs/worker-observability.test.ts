import { describe, expect, it, vi } from 'vitest'

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
}))
const captureObservabilityException = vi.hoisted(() => vi.fn())

vi.mock('#/shared/config/env', () => ({
  getEnv: () => ({ REDIS_URL: 'redis://unit-test:6379' }),
}))

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => logger,
}))

vi.mock('#/shared/observability/telemetry', () => ({
  captureObservabilityException,
}))

vi.mock('ioredis', () => ({
  Redis: class FakeRedis {
    constructor(
      public readonly url: string,
      public readonly options: unknown,
    ) {}
  },
}))

vi.mock('bullmq', () => {
  class FakeWorker {
    static instances: FakeWorker[] = []
    listeners = new Map<string, (...args: unknown[]) => void>()

    constructor(
      public readonly name: string,
      public readonly handler: unknown,
      public readonly options: unknown,
    ) {
      FakeWorker.instances.push(this)
    }

    on(event: string, listener: (...args: unknown[]) => void) {
      this.listeners.set(event, listener)
      return this
    }
  }

  return { Worker: FakeWorker }
})

import { Worker } from 'bullmq'
import { createJobWorker } from './worker'

type FakeWorker = Worker & {
  listeners: Map<string, (...args: unknown[]) => void>
}

function fakeWorkers(): FakeWorker[] {
  return (Worker as unknown as { instances: FakeWorker[] }).instances
}

describe('worker observability', () => {
  it('routes BullMQ error events through structured logging', () => {
    createJobWorker(
      'default',
      vi.fn(async () => undefined),
    )
    const error = Object.assign(new Error('connection string must not be logged'), {
      code: 'ECONNRESET',
    })
    fakeWorkers()[0].listeners.get('error')?.(error)

    expect(logger.error).toHaveBeenCalledWith(
      {
        component: 'bullmq-worker',
        queue: 'default',
        err: error,
      },
      'BullMQ worker error',
    )
    expect(captureObservabilityException).toHaveBeenCalledWith(error, {
      source: 'bullmq-worker',
      queue: 'default',
    })
  })

  it('captures only a job failure whose retry budget is exhausted', () => {
    createJobWorker(
      'background',
      vi.fn(async () => undefined),
    )
    const failed = fakeWorkers().at(-1)!.listeners.get('failed')!
    const error = new Error('private review text must not become a tag')

    failed({ name: 'retention-sweep', attemptsMade: 1, opts: { attempts: 3 } }, error)
    expect(captureObservabilityException).not.toHaveBeenCalledWith(
      error,
      expect.objectContaining({ source: 'bullmq-job' }),
    )

    failed({ name: 'retention-sweep', attemptsMade: 3, opts: { attempts: 3 } }, error)
    expect(captureObservabilityException).toHaveBeenCalledWith(error, {
      source: 'bullmq-job',
      queue: 'background',
      jobName: 'retention-sweep',
    })
    expect(logger.error).toHaveBeenLastCalledWith(
      {
        queue: 'background',
        jobName: 'retention-sweep',
        attemptsMade: 3,
        err: error,
      },
      'job failed',
    )
  })
})
