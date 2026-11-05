// Stamps the worker heartbeat and checks in with the Sentry cron monitor, so a
// worker that has died is noticed from outside it. The check-in also reports
// whether the web service answers its readiness URL. It follows the Redis write
// and can never fail it.

import * as Sentry from '@sentry/node'
import type { Logger } from 'pino'
import { getEnv } from '#/shared/config/env'
import {
  type RedisHeartbeatPort,
  writeWorkerHeartbeat,
} from '#/shared/health/worker-heartbeat'

/** How long the web readiness fetch may take before it counts as a failure. */
const WEB_HEALTH_REQUEST_TIMEOUT_MS = 5_000

// The same test telemetry.ts uses to decide that monitoring is mandatory.
function isDeployedProductionCell(): boolean {
  return (
    process.env.NODE_ENV === 'production' && Boolean(process.env.RAILWAY_ENVIRONMENT_NAME)
  )
}

// Sentry refuses uptime monitors on *.railway.app, so this monitor also covers
// the web service: the check-in is `ok` only while its public readiness URL
// answers 200. A failed check only changes the status, never the heartbeat.
async function checkWebHealth(logger: Pick<Logger, 'warn'>): Promise<'ok' | 'error'> {
  let response: Response
  try {
    response = await fetch(new URL('/api/health/ready', getEnv().BETTER_AUTH_URL), {
      // A redirect is not the readiness answer: report its status, never follow it.
      redirect: 'manual',
      signal: AbortSignal.timeout(WEB_HEALTH_REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    logger.warn({ err }, 'Worker web health check failed')
    return 'error'
  }
  if (response.status === 200) return 'ok'

  logger.warn({ status: response.status }, 'Worker web health check failed')
  return 'error'
}

export async function recordWorkerHeartbeat(
  redis: RedisHeartbeatPort | null | undefined,
  clock: () => Date,
  logger: Pick<Logger, 'warn'>,
): Promise<void> {
  await writeWorkerHeartbeat(redis, clock)

  try {
    if (!isDeployedProductionCell() || !Sentry.isEnabled()) return

    const status = await checkWebHealth(logger)

    // The Sentry client carries the Railway environment name, so the monitor
    // keeps a check-in history per environment.
    Sentry.captureCheckIn(
      { monitorSlug: 'worker-heartbeat', status },
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
