// Worker entry point — plain Node script, no Nitro
// Built separately with tsup, runs as: node dist/worker.js

import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'

function main() {
  const env = getEnv()
  const logger = getLogger()

  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Worker starting')
  logger.info('Worker heartbeat — no jobs registered yet')

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down')
    process.exit(0)
  })

  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down')
    process.exit(0)
  })
}

main()
