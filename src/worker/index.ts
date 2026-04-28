// Worker entry point — plain Node script, no Nitro
// Built separately with tsup, runs as: node dist/worker.js

import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'
import { createContainer } from '#/composition'
import { bootstrap } from '#/bootstrap'
import { createJobWorker } from '#/shared/jobs/worker'
import type { Worker } from 'bullmq'

function main() {
  const env = getEnv()
  const logger = getLogger()

  logger.info({ env: env.NODE_ENV }, 'Worker starting')

  // Build the dependency container
  const container = createContainer({ enableJobs: true })

  // Register all event handlers and job handlers
  bootstrap(container)

  // Track the worker for graceful shutdown
  let worker: Worker | undefined

  // Start BullMQ worker for the default queue
  if (container.jobQueue) {
    const registry = container.jobRegistry

    worker = createJobWorker('default', async (job) => {
      const handler = registry.getHandler(job.name)
      if (!handler) {
        logger.warn({ jobName: job.name, jobId: job.id }, 'no handler registered for job')
        return
      }
      await handler(job)
    })

    if (worker) {
      logger.info('BullMQ worker started, processing jobs from default queue')
    }

    // Schedule health-check job every 5 minutes
    container.jobQueue
      .add(
        'health-check',
        {},
        {
          repeat: { every: 5 * 60 * 1000 },
          jobId: 'health-check-recurring',
        },
      )
      .then(() => {
        logger.info('Health-check job scheduled (every 5 minutes)')
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'Failed to schedule health-check job (may already exist)')
      })
  } else {
    logger.warn('No Redis available — worker running without job processing')
  }

  // Graceful shutdown — drain in-progress jobs before exiting
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received, draining worker')
    if (worker) {
      try {
        await worker.close()
        logger.info('Worker drained successfully')
      } catch (err) {
        logger.error({ err }, 'Error draining worker')
      }
    }
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main()
