import { describe, expect, it, vi } from 'vitest'

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
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

vi.mock('#/shared/observability/trace', () => ({
  trace: (_name: string, run: () => unknown) => run(),
}))

vi.mock('ioredis', () => ({
  Redis: class FakeRedis {
    constructor(
      public readonly url: string,
      public readonly options: unknown,
    ) {}
  },
}))

vi.mock('bullmq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bullmq')>()
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

  return { ...actual, Worker: FakeWorker }
})

import { Worker, type Job, type Queue } from 'bullmq'
import { createJobWorker } from './worker'
import { getRequestContext } from '#/shared/observability/request-context'
import { createDispatcherHandler } from '#/shared/outbox/dispatcher'
import { createConsumerRegistry } from '#/shared/outbox/consumer-registry'
import type { OutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { registerEventSchema } from '#/shared/events/schema-registry'
import { z } from 'zod/v4'

type FakeWorker = Worker & {
  listeners: Map<string, (...args: unknown[]) => void>
  handler: unknown
}

function fakeWorkers(): FakeWorker[] {
  return (Worker as unknown as { instances: FakeWorker[] }).instances
}

describe('worker observability', () => {
  it.each(['malformed', 'exhausted', 'retryable'] as const)(
    'alerts through quarantine, runtime observations and Sentry only for terminal ledger delivery: %s',
    async (failureKind) => {
      if (failureKind === 'malformed') {
        registerEventSchema({
          type: 'test.malformed_payload',
          version: 1,
          schema: z.object({ resourceId: z.string() }),
        })
      }
      const work = {
        id: 'work-terminal',
        organizationId: 'org-1',
        subjectId: 'event-terminal',
        kind: 'outbox-delivery',
        leaseToken: 'lease-1',
        attempts: failureKind === 'exhausted' ? 32 : 1,
        maxAttempts: 32,
      }
      const readFailure = new Error('Stored fact unavailable')
      const fail = vi.fn(async () => [
        {
          ...work,
          state: failureKind === 'retryable' ? 'pending' : 'quarantined',
        },
      ])
      const repo = {
        delivery: {
          workItems: {
            resolveDispatch: async () => work,
            runExclusive: async (_id: string, run: () => Promise<unknown>) => run(),
            claim: async () => work,
            renew: async () => true,
            fail,
          },
          retryAt: () => new Date('2026-11-06T11:00:00Z'),
          readEvent: async () => {
            if (failureKind !== 'malformed') throw readFailure
            return {
              id: work.subjectId,
              eventType: 'test.malformed_payload',
              eventVersion: 1,
              payload: {},
              organizationId: work.organizationId,
              propertyId: null,
              sourceContext: 'test',
              sourceAggregateId: work.subjectId,
              recordedAt: new Date(),
            }
          },
        },
      } as unknown as OutboxRepository
      const observationSink = {
        recordStarted: vi.fn(async () => undefined),
        recordSucceeded: vi.fn(async () => undefined),
        recordDenied: vi.fn(async () => undefined),
        recordTerminalFailure: vi.fn(async () => undefined),
        recordStalled: vi.fn(async () => undefined),
      }
      const updateProgress = vi.fn(async () => undefined)
      const quarantineQueue = {
        add: vi.fn(async () => ({ id: 'quarantine-job' })),
        getJob: vi.fn(async () => ({ updateProgress })),
      } as unknown as Queue
      createJobWorker(
        'domain-events',
        createDispatcherHandler(repo, { consumers: createConsumerRegistry() }),
        1,
        quarantineQueue,
        observationSink,
      )
      const worker = fakeWorkers().at(-1)!
      const runtimeHandler = worker.handler as (job: Job) => Promise<unknown>
      const delivery = {
        id: 'work-terminal-1',
        name: 'outbox-delivery',
        queueName: 'domain-events',
        data: { workId: work.id },
        attemptsMade: 0,
        opts: { attempts: 1 },
      }
      const failure = await runtimeHandler(delivery as Job).catch(
        (error: unknown) => error,
      )
      expect(failure).toBeInstanceOf(Error)
      if (failureKind === 'malformed')
        expect(failure).toHaveProperty('name', 'UnrecoverableError')
      expect(fail).toHaveBeenCalledWith(
        work.organizationId,
        work.id,
        work.leaseToken,
        expect.objectContaining({ terminal: failureKind === 'malformed' }),
      )
      worker.listeners.get('failed')?.({ ...delivery, attemptsMade: 1 }, failure)

      if (failureKind === 'retryable') {
        expect(failure).toBe(readFailure)
        expect(quarantineQueue.add).not.toHaveBeenCalled()
        expect(quarantineQueue.getJob).not.toHaveBeenCalled()
        expect(observationSink.recordTerminalFailure).not.toHaveBeenCalled()
        expect(captureObservabilityException).not.toHaveBeenCalledWith(
          failure,
          expect.objectContaining({ source: 'bullmq-job' }),
        )
        return
      }

      await vi.waitFor(() => expect(updateProgress).toHaveBeenCalledOnce())
      expect(quarantineQueue.add).toHaveBeenCalledOnce()
      expect(observationSink.recordTerminalFailure).toHaveBeenCalledWith(
        expect.objectContaining({ queue: 'domain-events', jobId: delivery.id }),
      )
      expect(captureObservabilityException).toHaveBeenCalledWith(failure, {
        source: 'bullmq-job',
        queue: 'domain-events',
        jobName: 'outbox-delivery',
      })
      if (failureKind === 'exhausted')
        expect(failure).toHaveProperty('cause', readFailure)
    },
  )

  it('routes BullMQ error events through structured logging', () => {
    createJobWorker(
      'default',
      vi.fn(async () => undefined),
    )
    const error = Object.assign(new Error('connection string must not be logged'), {
      code: 'ECONNRESET',
    })
    fakeWorkers().at(-1)!.listeners.get('error')?.(error)

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

  it('installs the BullMQ job id as the durable-fact causation context', async () => {
    let causationId: string | undefined
    createJobWorker('default', async () => {
      causationId = getRequestContext()?.causationId
    })
    const runtimeHandler = fakeWorkers().at(-1)!.handler as (job: Job) => Promise<unknown>

    await runtimeHandler({
      id: 'outbox-event-1',
      name: 'review.created',
      data: {},
    } as Job)

    expect(causationId).toBe('outbox-event-1')
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

  it.each(['default', 'domain-events'])(
    'leaves a failed work-ID delivery on %s to ledger recovery without a legacy dead letter',
    async (queueName) => {
      const observationSink = {
        recordStarted: vi.fn(async () => undefined),
        recordSucceeded: vi.fn(async () => undefined),
        recordDenied: vi.fn(async () => undefined),
        recordTerminalFailure: vi.fn(async () => undefined),
        recordStalled: vi.fn(async () => undefined),
      }
      const updateProgress = vi.fn(async () => undefined)
      const quarantineQueue = {
        add: vi.fn(async () => ({ id: 'quarantine-job' })),
        getJob: vi.fn(async () => ({ updateProgress })),
      } as unknown as Queue
      const failure = new Error('transient consumer failure')
      createJobWorker(
        queueName,
        vi.fn(async () => {
          throw failure
        }),
        1,
        quarantineQueue,
        observationSink,
      )
      const worker = fakeWorkers().at(-1)!
      const runtimeHandler = worker.handler as (job: Job) => Promise<unknown>
      const delivery = {
        id: 'work-1-dispatch-1',
        name: 'review.created',
        queueName,
        data: { workId: 'work-1' },
        attemptsMade: 0,
        opts: { attempts: 1 },
      }

      await expect(runtimeHandler(delivery as Job)).rejects.toBe(failure)
      worker.listeners.get('failed')?.(
        { ...delivery, attemptsMade: 1 },
        failure,
        'active',
      )
      await Promise.resolve()

      expect(quarantineQueue.add).not.toHaveBeenCalled()
      expect(quarantineQueue.getJob).not.toHaveBeenCalled()
      expect(updateProgress).not.toHaveBeenCalled()
      expect(observationSink.recordTerminalFailure).not.toHaveBeenCalled()
      expect(captureObservabilityException).not.toHaveBeenCalledWith(
        failure,
        expect.objectContaining({ source: 'bullmq-job' }),
      )
    },
  )

  it.each([undefined, null, [], {}, { workId: '' }, { workId: null }, { workId: 1 }])(
    'keeps legacy quarantine for a final attempt with no valid work ID: %j',
    async (data) => {
      const observationSink = {
        recordStarted: vi.fn(async () => undefined),
        recordSucceeded: vi.fn(async () => undefined),
        recordDenied: vi.fn(async () => undefined),
        recordTerminalFailure: vi.fn(async () => undefined),
        recordStalled: vi.fn(async () => undefined),
      }
      const updateProgress = vi.fn(async () => undefined)
      const quarantineQueue = {
        add: vi.fn(async () => ({ id: 'quarantine-job' })),
        getJob: vi.fn(async () => ({ updateProgress })),
      } as unknown as Queue
      const failure = new Error('legacy final attempt failed')
      createJobWorker(
        'domain-events',
        vi.fn(async () => {
          throw failure
        }),
        1,
        quarantineQueue,
        observationSink,
      )
      const worker = fakeWorkers().at(-1)!
      const runtimeHandler = worker.handler as (job: Job) => Promise<unknown>
      const delivery = {
        id: 'legacy-event-1',
        name: 'review.created',
        queueName: 'domain-events',
        data,
        attemptsMade: 0,
        opts: { attempts: 1 },
      }

      await expect(runtimeHandler(delivery as Job)).rejects.toBe(failure)
      worker.listeners.get('failed')?.(
        { ...delivery, attemptsMade: 1 },
        failure,
        'active',
      )

      await vi.waitFor(() => expect(updateProgress).toHaveBeenCalledOnce())
      expect(quarantineQueue.add).toHaveBeenCalledOnce()
      expect(quarantineQueue.getJob).toHaveBeenCalledWith(
        'quarantine:domain-events:legacy-event-1',
      )
      expect(observationSink.recordTerminalFailure).toHaveBeenCalledOnce()
      expect(captureObservabilityException).toHaveBeenCalledWith(failure, {
        source: 'bullmq-job',
        queue: 'domain-events',
        jobName: 'review.created',
      })
    },
  )

  it('fails a schedule firing terminally without a dead letter or a transport error', async () => {
    const observationSink = {
      recordStarted: vi.fn(async () => undefined),
      recordSucceeded: vi.fn(async () => undefined),
      recordDenied: vi.fn(async () => undefined),
      recordTerminalFailure: vi.fn(async () => undefined),
      recordStalled: vi.fn(async () => undefined),
    }
    const quarantineQueue = {
      add: vi.fn(async () => ({ id: 'quarantine-job' })),
      getJob: vi.fn(async () => undefined),
    } as unknown as Queue
    const failure = new Error('lock timeout')
    createJobWorker(
      'background',
      vi.fn(async () => {
        throw failure
      }),
      1,
      quarantineQueue,
      observationSink,
    )
    const worker = fakeWorkers().at(-1)!
    const runtimeHandler = worker.handler as (job: Job) => Promise<unknown>
    const firing = {
      id: 'repeat:schedule-property-ai-trends-recurring:1791090138172',
      name: 'schedule-property-ai-trends',
      queueName: 'background',
      repeatJobKey: 'schedule-property-ai-trends-recurring',
      data: {},
      opts: { attempts: 3 },
    }
    logger.error.mockClear()

    await expect(runtimeHandler({ ...firing, attemptsMade: 2 } as Job)).rejects.toBe(
      failure,
    )
    worker.listeners.get('failed')?.({ ...firing, attemptsMade: 3 }, failure, 'active')

    await vi.waitFor(() =>
      expect(observationSink.recordTerminalFailure).toHaveBeenCalledWith({
        queue: 'background',
        jobName: 'schedule-property-ai-trends',
        jobId: firing.id,
        at: expect.any(Date),
        executionKind: 'schedule',
      }),
    )
    expect(captureObservabilityException).toHaveBeenCalledWith(failure, {
      source: 'bullmq-job',
      queue: 'background',
      jobName: 'schedule-property-ai-trends',
    })
    expect(quarantineQueue.add).not.toHaveBeenCalled()
    expect(quarantineQueue.getJob).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      { queue: 'background', jobName: 'schedule-property-ai-trends' },
      'terminal schedule firing failure — not dead-lettered, the next firing repeats the pass',
    )
    // The only error is the failure itself, never a refused dead-letter write.
    expect(logger.error.mock.calls.map(([, message]) => message)).toEqual(['job failed'])
  })

  it('records a gate-denied completion as a denial, never as a success', async () => {
    const observationSink = {
      recordStarted: vi.fn(async () => undefined),
      recordSucceeded: vi.fn(async () => undefined),
      recordDenied: vi.fn(async () => undefined),
      recordTerminalFailure: vi.fn(async () => undefined),
      recordStalled: vi.fn(async () => undefined),
    }
    createJobWorker(
      'background',
      vi.fn(async () => undefined),
      1,
      undefined,
      observationSink,
    )
    const listeners = fakeWorkers().at(-1)!.listeners
    const firing = { id: 'repeat:goal-1', name: 'goal-program.maintain', data: {} }

    listeners.get('completed')?.(
      firing,
      { gate: 'denied', reason: 'missing_scope', executionKind: 'schedule' },
      'active',
    )

    await vi.waitFor(() => {
      expect(observationSink.recordDenied).toHaveBeenCalledWith({
        queue: 'background',
        jobName: 'goal-program.maintain',
        jobId: 'repeat:goal-1',
        at: expect.any(Date),
        executionKind: 'schedule',
      })
    })
    expect(observationSink.recordSucceeded).not.toHaveBeenCalled()
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ jobName: 'goal-program.maintain' }),
      'job completed',
    )
  })

  it('persists started, successful, terminal-failure, and stalled runtime heads', async () => {
    const observationSink = {
      recordStarted: vi.fn(async () => undefined),
      recordSucceeded: vi.fn(async () => undefined),
      recordDenied: vi.fn(async () => undefined),
      recordTerminalFailure: vi.fn(async () => undefined),
      recordStalled: vi.fn(async () => undefined),
    }
    createJobWorker(
      'background',
      vi.fn(async () => undefined),
      1,
      undefined,
      observationSink,
    )
    const listeners = fakeWorkers().at(-1)!.listeners
    const job = {
      id: 'job-1',
      name: 'health-check',
      attemptsMade: 3,
      opts: { attempts: 3 },
    }

    listeners.get('active')?.(job, 'waiting')
    listeners.get('completed')?.(job, undefined, 'active')
    listeners.get('completed')?.(
      {
        ...job,
        id: 'redrive-1',
        data: {
          redriveMetadata: {
            redrivenFrom: 'quarantine',
          },
        },
      },
      undefined,
      'active',
    )
    listeners.get('failed')?.(job, new Error('terminal'), 'active')
    listeners.get('stalled')?.('job-1', 'active')

    await vi.waitFor(() => {
      expect(observationSink.recordStarted).toHaveBeenCalledWith(
        expect.objectContaining({
          queue: 'background',
          jobName: 'health-check',
          jobId: 'job-1',
          at: expect.any(Date),
        }),
      )
      expect(observationSink.recordSucceeded).toHaveBeenCalledTimes(2)
      expect(observationSink.recordSucceeded).toHaveBeenCalledWith(
        expect.objectContaining({ repair: false }),
      )
      expect(observationSink.recordSucceeded).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: 'redrive-1', repair: true }),
      )
      expect(observationSink.recordTerminalFailure).toHaveBeenCalledTimes(1)
      // Enqueued on demand, not fired by a scheduler: its own latch.
      expect(observationSink.recordTerminalFailure).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: 'job-1', executionKind: 'worker' }),
      )
      expect(observationSink.recordDenied).not.toHaveBeenCalled()
      expect(observationSink.recordStalled).toHaveBeenCalledWith(
        expect.objectContaining({
          queue: 'background',
          jobId: 'job-1',
          at: expect.any(Date),
        }),
      )
    })
  })
})
