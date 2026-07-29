// BullMQ queue factory — creates named queues backed by dedicated Redis connection.
// Per architecture: "shared/jobs/ holds queue/worker factories and job registry."
//
// NOTE: This should only be called in the worker process (via createContainer({ enableJobs: true })).
// The web process does not need a BullMQ queue — it only needs Redis for caching/rate limiting.
// The enableJobs flag in composition.ts controls whether this factory is invoked.
//
// Uses a dedicated ioredis connection with maxRetriesPerRequest=null, matching the worker pattern.
// BullMQ recommends all Redis connections (Queue + Worker) use maxRetriesPerRequest=null to avoid
// MaxRetriesPerRequestError under Redis instability. The shared caching Redis client (getRedis())
// uses maxRetriesPerRequest=3 which is unsuitable for BullMQ.

import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { getEnv } from '#/shared/config/env'

export type { Queue }

// BQC-7.1: BullMQ marks a user-supplied ioredis instance as `shared` and
// deliberately does NOT close it on queue.close() (queue-base.js:
// `shared: isRedisInstance(opts.connection)`). Track every dedicated
// connection the factory creates so the web graceful-shutdown path can quit
// them explicitly — otherwise the sockets keep the event loop alive past
// SIGTERM. Symbol.for: the production web build bundles this module twice
// (nitro app chunk + lazy SSR chunk); the registry must be process-wide.
// The worker process never reads the registry (its shutdown ends in
// process.exit, which reaps the sockets).
const CONNECTIONS_KEY = Symbol.for('repkey.shared.jobs.queueConnections')
type ConnectionStore = { [CONNECTIONS_KEY]?: Set<Redis> }

function connectionStore(): Set<Redis> {
  const store = globalThis as ConnectionStore
  store[CONNECTIONS_KEY] ??= new Set()
  return store[CONNECTIONS_KEY]
}

/**
 * Create a named BullMQ queue.
 * Uses a dedicated Redis connection with maxRetriesPerRequest=null (required by BullMQ).
 * Returns undefined if Redis is not configured (REDIS_URL missing).
 * Callers MUST check for undefined before using the queue.
 */
export function createJobQueue(name: string): Queue | undefined {
  const env = getEnv()
  if (!env.REDIS_URL) return undefined

  // Dedicated connection for BullMQ Queue operations.
  // Cannot share the caching Redis client which uses maxRetriesPerRequest=3.
  const connection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  })
  connectionStore().add(connection)

  return new Queue(name, {
    connection: connection as unknown as import('bullmq').ConnectionOptions,
    defaultJobOptions: {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
      attempts: 3,
      // Delayed retries so a transient DB/Redis blip doesn't burn all attempts
      // within milliseconds. Honoured by the worker's backoffStrategy.
      backoff: { type: 'exponential', delay: 30_000 },
    },
  })
}

/**
 * Quit every tracked dedicated queue connection (BQC-7.1 graceful shutdown,
 * web process — see CONNECTIONS_KEY note). Idempotent: already-ended
 * connections are skipped; a connection that refuses quit() is force-
 * disconnected so the event loop can drain. Never throws.
 */
export async function closeJobQueueConnections(): Promise<void> {
  const connections = [...connectionStore()]
  connectionStore().clear()
  await Promise.all(
    connections.map(async (connection) => {
      if (connection.status === 'end') return
      try {
        await connection.quit()
      } catch {
        connection.disconnect()
      }
    }),
  )
}
