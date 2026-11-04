// Stamps the worker heartbeat and checks in with the Sentry cron monitor, so a
// worker that has died is noticed from outside it. The check-in follows the
// Redis write and can never fail it.

import * as Sentry from '@sentry/node'
import type { Logger } from 'pino'
import {
  type RedisHeartbeatPort,
  writeWorkerHeartbeat,
} from '#/shared/health/worker-heartbeat'

// The same test telemetry.ts uses to decide that monitoring is mandatory.
function isDeployedProductionCell(): boolean {
  return (
    process.env.NODE_ENV === 'production' && Boolean(process.env.RAILWAY_ENVIRONMENT_NAME)
  )
}

export async function recordWorkerHeartbeat(
  redis: RedisHeartbeatPort | null | undefined,
  clock: () => Date,
  logger: Pick<Logger, 'warn'>,
): Promise<void> {
  await writeWorkerHeartbeat(redis, clock)

  try {
    if (!isDeployedProductionCell() || !Sentry.isEnabled()) return

    // The Sentry client carries the Railway environment name, so the monitor
    // keeps a check-in history per environment.
    Sentry.captureCheckIn(
      { monitorSlug: 'worker-heartbeat', status: 'ok' },
      {
        schedule: { type: 'interval', value: 5, unit: 'minute' },
        checkinMargin: 5,
        maxRuntime: 1,
        failureIssueThreshold: 2,
        recoveryThreshold: 1,
      },
    )
  } catch (err) {
    logger.warn({ err }, 'Worker heartbeat check-in failed')
  }
}
