// BullMQ queue factory — creates named queues backed by dedicated Redis connection.
// Per architecture: "shared/jobs/ holds queue/worker factories and job registry."
//
// The web process owns producer-only Queue handles for post-commit enqueueing.
// The worker owns producer handles, Worker consumers, and the background
// Queue; composition's enableJobs flag controls that consumer-only surface.
//
// Queue producers and Workers intentionally have different outage behavior:
// producers fail within a bounded command/retry budget so HTTP and relay calls
// never wait forever, while Worker blocking connections retry indefinitely.

import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'
import { getJobRedisUrl } from './redis-topology'

export type { Queue }

export const JOB_QUEUE_COMMAND_TIMEOUT_MS = 5_000

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
 * Uses a dedicated bounded Redis producer connection.
 * Returns undefined if queue Redis is not configured. Production requires
 * QUEUE_REDIS_URL; development/test may fall back to REDIS_URL.
 * Callers MUST check for undefined before using the queue.
 */
export function createJobQueue(name: string): Queue | undefined {
  const env = getEnv()
  const redisUrl = getJobRedisUrl(env)
  if (!redisUrl) return undefined

  // BullMQ's producer guidance is deliberately different from its Worker
  // guidance: a Queue operation must fail quickly during a Redis outage so
  // the HTTP path can report failure and the durable outbox relay can retry.
  // commandTimeout also bounds a connected-but-unresponsive Redis endpoint;
  // maxRetriesPerRequest alone only bounds reconnect cycles.
  const connection = new Redis(redisUrl, {
    commandTimeout: JOB_QUEUE_COMMAND_TIMEOUT_MS,
    connectTimeout: JOB_QUEUE_COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
  })
  connectionStore().add(connection)

  const queue = new Queue(name, {
    connection: connection as unknown as import('bullmq').ConnectionOptions,
    defaultJobOptions: {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
      attempts: 3,
      // Delayed retries so a transient DB/Redis blip doesn't burn all attempts
      // within milliseconds. BullMQ's native retry handling honors these job
      // options; the Worker intentionally installs no custom backoffStrategy.
      backoff: { type: 'exponential', delay: 30_000 },
    },
  })
  queue.on('error', (err) => {
    getLogger().error(
      { component: 'bullmq-queue', queue: name, err },
      'BullMQ queue error',
    )
  })
  return queue
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
