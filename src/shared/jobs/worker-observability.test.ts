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

import { Worker, type Job, type Queue } from 'bullmq'
import { createJobWorker } from './worker'

type FakeWorker = Worker & {
  listeners: Map<string, (...args: unknown[]) => void>
  handler: unknown
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

  it('keeps a final attempt active until a delayed quarantine write settles', async () => {
    let releaseQuarantine!: () => void
    const quarantineQueue = {
      add: vi.fn(
        () =>
          new Promise((resolve) => {
            releaseQuarantine = () => resolve({ id: 'quarantine-job' })
          }),
      ),
    } as unknown as Queue
    const failure = new Error('synthetic private marker')
    createJobWorker(
      'default',
      vi.fn(async () => {
        throw failure
      }),
      1,
      quarantineQueue,
    )
    const runtimeHandler = fakeWorkers().at(-1)!.handler as (job: Job) => Promise<unknown>
    let settled = false
    const execution = runtimeHandler({
      id: 'job-1',
      name: 'sync-property-reviews',
      queueName: 'default',
      data: { propertyId: 'property-1', organizationId: 'organization-1' },
      attemptsMade: 2,
      opts: { attempts: 3 },
    } as Job).finally(() => {
      settled = true
    })

    await vi.waitFor(() => expect(quarantineQueue.add).toHaveBeenCalledTimes(1))
    expect(settled).toBe(false)
    expect(quarantineQueue.add).toHaveBeenCalledWith(
      'sync-property-reviews',
      expect.objectContaining({
        attemptsMade: 3,
        publicationState: 'pending_failure',
      }),
      expect.objectContaining({ jobId: 'quarantine:default:job-1' }),
    )

    releaseQuarantine()
    await expect(execution).rejects.toBe(failure)
    expect(settled).toBe(true)
  })

  it('confirms only terminal failed events, including early UnrecoverableError', async () => {
    const updateProgress = vi.fn(async () => undefined)
    const quarantineQueue = {
      add: vi.fn(async () => ({ id: 'quarantine-job' })),
      getJob: vi.fn(async () => ({ updateProgress })),
    } as unknown as Queue
    createJobWorker(
      'default',
      vi.fn(async () => undefined),
      1,
      quarantineQueue,
    )
    const failed = fakeWorkers().at(-1)!.listeners.get('failed')!

    const retryable = new Error('transient')
    failed(
      {
        id: 'job-1',
        name: 'sync-property-reviews',
        queueName: 'default',
        attemptsMade: 1,
        opts: { attempts: 8 },
      },
      retryable,
    )
    expect(quarantineQueue.getJob).not.toHaveBeenCalled()
    expect(captureObservabilityException).not.toHaveBeenCalledWith(
      retryable,
      expect.objectContaining({ source: 'bullmq-job' }),
    )

    const unrecoverable = Object.assign(new Error('schema poison'), {
      name: 'UnrecoverableError',
    })
    failed(
      {
        id: 'job-2',
        name: 'sync-property-reviews',
        queueName: 'default',
        attemptsMade: 1,
        opts: { attempts: 8 },
      },
      unrecoverable,
    )

    await vi.waitFor(() => expect(updateProgress).toHaveBeenCalledTimes(1))
    expect(quarantineQueue.getJob).toHaveBeenCalledWith('quarantine:default:job-2')
    expect(captureObservabilityException).toHaveBeenCalledWith(unrecoverable, {
      source: 'bullmq-job',
      queue: 'default',
      jobName: 'sync-property-reviews',
    })
  })
})
