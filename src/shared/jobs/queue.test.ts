// BQC-7.1 — BullMQ queue factory + dedicated-connection registry tests.
//
// Pins the graceful-shutdown contract for queue connections:
//   1. REDIS_URL absent → no queue, no connection;
//   2. creation wires the dedicated connection (maxRetriesPerRequest=null —
//      BullMQ's requirement) and the hardened defaultJobOptions, and tracks
//      the connection in the process-wide registry;
//   3. closeJobQueueConnections quits tracked connections (BullMQ marks
//      user-supplied instances `shared` and deliberately does NOT close them
//      on queue.close() — the registry is the only path that reaps them),
//      force-disconnects a connection whose quit() rejects, skips
//      already-ended ones, and is idempotent (second call touches nothing).
//
// ioredis and bullmq are mocked — the unit project is hermetic.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resetEnv } from '#/shared/config/env'

const loggerError = vi.hoisted(() => vi.fn())

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({ error: loggerError }),
}))

vi.mock('ioredis', () => {
  class FakeRedis {
    static instances: FakeRedis[] = []
    status = 'ready'
    quit = vi.fn(async () => {
      this.status = 'end'
      return 'OK'
    })
    disconnect = vi.fn(() => {
      this.status = 'end'
    })

    constructor(
      public readonly url: string,
      public readonly options: unknown,
    ) {
      FakeRedis.instances.push(this)
    }
  }
  return { Redis: FakeRedis }
})

vi.mock('bullmq', () => {
  class FakeQueue {
    static instances: FakeQueue[] = []
    listeners = new Map<string, (...args: unknown[]) => void>()

    constructor(
      public readonly name: string,
      public readonly opts: unknown,
    ) {
      FakeQueue.instances.push(this)
    }

    on(event: string, listener: (...args: unknown[]) => void) {
      this.listeners.set(event, listener)
      return this
    }
  }
  return { Queue: FakeQueue }
})

import { Redis } from 'ioredis'
import { Queue } from 'bullmq'
import { createJobQueue, closeJobQueueConnections } from './queue'

type FakeRedisInstance = Redis & {
  url: string
  options: unknown
  status: string
  quit: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}
type FakeQueueInstance = Queue & {
  name: string
  opts: Record<string, unknown>
  listeners: Map<string, (...args: unknown[]) => void>
}

function fakeConnections(): FakeRedisInstance[] {
  return (Redis as unknown as { instances: FakeRedisInstance[] }).instances
}
function fakeQueues(): FakeQueueInstance[] {
  return (Queue as unknown as { instances: FakeQueueInstance[] }).instances
}

const CONNECTIONS_KEY = Symbol.for('repkey.shared.jobs.queueConnections')
const ORIGINAL_REDIS_URL = process.env.REDIS_URL

function clearStore(): void {
  delete (globalThis as Record<symbol, unknown>)[CONNECTIONS_KEY]
}

beforeEach(() => {
  clearStore()
  fakeConnections().length = 0
  fakeQueues().length = 0
  vi.clearAllMocks()
})

afterEach(() => {
  clearStore()
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL
  resetEnv()
})

describe('createJobQueue', () => {
  it('returns undefined and creates nothing when REDIS_URL is absent', () => {
    delete process.env.REDIS_URL
    resetEnv()

    expect(createJobQueue('default')).toBeUndefined()
    expect(fakeConnections()).toHaveLength(0)
    expect(fakeQueues()).toHaveLength(0)
  })

  it('creates the queue on a tracked dedicated connection with hardened job defaults', () => {
    process.env.REDIS_URL = 'redis://unit-test:6379'
    resetEnv()

    const queue = createJobQueue('default')

    expect(queue).toBeDefined()
    expect(fakeQueues()).toHaveLength(1)
    expect(fakeQueues()[0].name).toBe('default')
    expect(fakeQueues()[0].opts.defaultJobOptions).toEqual({
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
    })
    // BullMQ-required connection options, and the connection IS the one the
    // queue was built with — the registry must reap what queue.close() won't.
    expect(fakeConnections()).toHaveLength(1)
    expect(fakeConnections()[0].options).toEqual({ maxRetriesPerRequest: null })
    expect(fakeQueues()[0].opts.connection).toBe(fakeConnections()[0])
  })

  it('routes BullMQ error events through structured logging', () => {
    process.env.REDIS_URL = 'redis://unit-test:6379'
    resetEnv()

    createJobQueue('background')
    const error = Object.assign(new Error('connection string must not be logged'), {
      code: 'ECONNRESET',
    })
    fakeQueues()[0].listeners.get('error')?.(error)

    expect(loggerError).toHaveBeenCalledWith(
      {
        component: 'bullmq-queue',
        queue: 'background',
        err: error,
      },
      'BullMQ queue error',
    )
  })
})

describe('closeJobQueueConnections', () => {
  it('quits every tracked connection and clears the registry', async () => {
    process.env.REDIS_URL = 'redis://unit-test:6379'
    resetEnv()
    createJobQueue('default')
    createJobQueue('background')
    const [first, second] = fakeConnections()

    await closeJobQueueConnections()

    expect(first.quit).toHaveBeenCalledOnce()
    expect(second.quit).toHaveBeenCalledOnce()
    // Idempotent: the registry was cleared, a second close touches nothing.
    await closeJobQueueConnections()
    expect(first.quit).toHaveBeenCalledOnce()
    expect(second.quit).toHaveBeenCalledOnce()
  })

  it('force-disconnects a connection whose quit() rejects', async () => {
    process.env.REDIS_URL = 'redis://unit-test:6379'
    resetEnv()
    createJobQueue('default')
    const [connection] = fakeConnections()
    connection.quit.mockRejectedValueOnce(new Error('stuck pipeline'))

    await expect(closeJobQueueConnections()).resolves.toBeUndefined()

    expect(connection.disconnect).toHaveBeenCalledOnce()
  })

  it('skips connections that are already ended', async () => {
    process.env.REDIS_URL = 'redis://unit-test:6379'
    resetEnv()
    createJobQueue('default')
    const [connection] = fakeConnections()
    connection.status = 'end'

    await closeJobQueueConnections()

    expect(connection.quit).not.toHaveBeenCalled()
    expect(connection.disconnect).not.toHaveBeenCalled()
  })
})
