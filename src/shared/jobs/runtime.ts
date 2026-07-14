// JobRuntime — owns queues, workers, schedulers, and lifecycle (PRE17A A2).
//
// The runtime accepts job definitions from context manifests, validates
// uniqueness, creates BullMQ queues and workers per queue class, registers
// Job Schedulers for repeatable jobs, and provides bounded shutdown.
//
// Adding a new job or schedule requires changing only the owning context
// manifest and composition registration, not src/worker/index.ts.

import { Queue, Worker, type Job } from 'bullmq'
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'
import { createJobQueue } from './queue'
import { createJobWorker } from './worker'
import { getPolicyJobOptions } from './policies'
import type { JobHandler } from './registry'
import type { JobDefinition, QueueClass, ScheduleDefinition } from './contracts'

// ── Queue class configuration ───────────────────────────────────────

const QUEUE_CONFIG: Readonly<
  Record<QueueClass, Readonly<{ concurrency: number; name: string }>>
> = {
  interactive: { name: 'default', concurrency: 10 },
  background: { name: 'background', concurrency: 3 },
  'domain-events': { name: 'domain-events', concurrency: 20 },
} as const

// ── Validation ──────────────────────────────────────────────────────

class JobValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JobValidationError'
  }
}

function validateManifests(definitions: readonly JobDefinition[]): void {
  const jobNames = new Set<string>()
  const schedulerIds = new Set<string>()

  for (const def of definitions) {
    // Validate unique job name
    if (jobNames.has(def.name)) {
      throw new JobValidationError(
        `Duplicate job name "${def.name}" — each job must have a unique name across all contexts`,
      )
    }
    jobNames.add(def.name)

    // Validate unique scheduler ID
    if (def.schedule) {
      if (schedulerIds.has(def.schedule.schedulerId)) {
        throw new JobValidationError(
          `Duplicate scheduler ID "${def.schedule.schedulerId}" on job "${def.name}" — each schedule must have a unique ID`,
        )
      }
      schedulerIds.add(def.schedule.schedulerId)

      if (!def.schedule.pattern && !def.schedule.every) {
        throw new JobValidationError(
          `Schedule for job "${def.name}" must have either pattern or every`,
        )
      }
    }

    // Validate handler exists
    if (typeof def.handler !== 'function') {
      throw new JobValidationError(`Job "${def.name}" has no handler function`)
    }
  }
}

// ── JobRuntime ──────────────────────────────────────────────────────

export type JobRuntime = Readonly<{
  /** Start the runtime: create queues, workers, register schedulers. */
  start: () => Promise<void>
  /** Graceful shutdown with a drain deadline (ms). Exits non-zero if drain fails. */
  shutdown: (deadlineMs?: number) => Promise<void>
  /** Get the queue for a class (for enqueuing jobs). */
  getQueue: (queueClass: QueueClass) => Queue | undefined
  /** Enqueue a job by name with payload. */
  enqueue: (name: string, data: unknown, queueClass?: QueueClass) => Promise<Job>
}>

/**
 * Create a JobRuntime from job definitions.
 *
 * Validates all definitions, creates queues/workers per queue class,
 * and registers BullMQ Job Schedulers for repeatable jobs.
 *
 * @param definitions - All job definitions from all context manifests.
 * @returns The runtime handle.
 * @throws {JobValidationError} if any validation fails.
 */
export function createJobRuntime(definitions: readonly JobDefinition[]): JobRuntime {
  const logger = getLogger()
  const env = getEnv()

  // Validate before creating any infrastructure
  validateManifests(definitions)

  // Build handler lookup
  const handlers = new Map<string, JobHandler>()
  const schedulerIds = new Set<string>()
  for (const def of definitions) {
    handlers.set(def.name, def.handler)
    if (def.schedule) {
      schedulerIds.add(def.schedule.schedulerId)
    }
  }

  // Group definitions by queue class
  const byQueue = new Map<QueueClass, JobDefinition[]>()
  for (const def of definitions) {
    const list = byQueue.get(def.queue) ?? []
    list.push(def)
    byQueue.set(def.queue, list)
  }

  const queues = new Map<QueueClass, Queue>()
  const workers = new Map<QueueClass, Worker>()

  // Shared dispatch handler — looks up the handler by job name
  const dispatch = async (job: Job) => {
    const handler = handlers.get(job.name)
    if (!handler) {
      logger.warn({ jobName: job.name, jobId: job.id }, 'no handler registered for job')
      return
    }
    await handler(job)
  }

  return {
    async start() {
      if (!env.REDIS_URL) {
        logger.warn('No REDIS_URL — JobRuntime not started')
        return
      }

      // Create queues and workers for each queue class that has jobs
      for (const [queueClass, queueDefs] of byQueue) {
        const config = QUEUE_CONFIG[queueClass]
        const queue = createJobQueue(config.name)
        if (queue) queues.set(queueClass, queue)

        const worker = createJobWorker(config.name, dispatch, config.concurrency)
        if (worker) workers.set(queueClass, worker)

        logger.info(
          { queue: config.name, concurrency: config.concurrency, jobs: queueDefs.length },
          'Worker started for queue class',
        )

        // Register schedulers for repeatable jobs
        for (const def of queueDefs) {
          if (!def.schedule || !queue) continue
          await registerScheduler(queue, def.name, def.schedule, def.retry)
          logger.info(
            { job: def.name, schedulerId: def.schedule.schedulerId },
            'Scheduler registered',
          )
        }
      }

      logger.info(
        { queues: queues.size, workers: workers.size, jobs: definitions.length },
        'JobRuntime started',
      )
    },

    getQueue(queueClass: QueueClass) {
      return queues.get(queueClass)
    },

    async enqueue(name: string, data: unknown, queueClass: QueueClass = 'interactive') {
      const queue = queues.get(queueClass)
      if (!queue) {
        throw new Error(`No queue for class "${queueClass}". Has the runtime started?`)
      }
      const def = definitions.find((d) => d.name === name)
      if (!def) {
        throw new Error(`Unknown job "${name}" — not in any manifest`)
      }
      const jobOptions = getPolicyJobOptions(def.retry)
      return queue.add(name, data, { ...jobOptions })
    },

    async shutdown(deadlineMs = 30_000) {
      logger.info({ deadlineMs }, 'JobRuntime shutdown — draining workers')

      // Close workers first (stop accepting new work)
      for (const [queueClass, worker] of workers) {
        try {
          await Promise.race([
            worker.close(),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Drain timeout for ${queueClass}`)),
                deadlineMs,
              ),
            ),
          ])
          logger.info({ queueClass }, 'Worker drained')
        } catch (err) {
          logger.error({ err, queueClass }, 'Worker drain failed — forcing exit')
        }
      }

      // Close queues
      for (const [queueClass, queue] of queues) {
        try {
          await queue.close()
          logger.info({ queueClass }, 'Queue closed')
        } catch (err) {
          logger.error({ err, queueClass }, 'Queue close failed')
        }
      }

      logger.info('JobRuntime shutdown complete')
    },
  }
}

// ── Scheduler registration ──────────────────────────────────────────

async function registerScheduler(
  queue: Queue,
  jobName: string,
  schedule: ScheduleDefinition,
  retry: import('./contracts').RetryPolicyName,
): Promise<void> {
  const repeat = schedule.pattern
    ? { pattern: schedule.pattern }
    : { every: schedule.every! }

  const jobOptions = getPolicyJobOptions(retry)

  // Apply stagger jitter if configured
  if (schedule.staggerMs) {
    const jitter = Math.floor(Math.random() * schedule.staggerMs)
    Object.assign(repeat, { offset: jitter })
  }

  await queue.add(
    jobName,
    {},
    {
      repeat,
      jobId: schedule.schedulerId,
      ...jobOptions,
    },
  )
}
