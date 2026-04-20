// Worker entry point — plain Node script, no Nitro
// Built separately with tsup, runs as: node dist/worker.js

import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'

async function main() {
  const env = getEnv()
  const logger = getLogger()

  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Worker starting')

  // Phase 1: just a health-check heartbeat
  // BullMQ queues, event handlers, and jobs will be added in Phase 4
  logger.info('Worker heartbeat — no jobs registered yet')

  // Keep the process alive
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down')
    process.exit(0)
  })

  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down')
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('Worker failed to start', err)
  process.exit(1)
})
