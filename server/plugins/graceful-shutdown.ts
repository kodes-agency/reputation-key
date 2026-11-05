// Nitro plugin: graceful shutdown for the web process.
//
// Registered explicitly through the `plugins` array in vite.config.ts: Nitro's
// serverDir scanning stays off under TanStack Start, so only this plugin is wired.
//
// On SIGTERM or SIGINT the process stops admitting requests (a late one on an
// open connection gets 503), waits for the ones already admitted, then closes the
// container, Redis, the database pool and the error-monitoring flush in that
// order, all inside one deadline: DRAIN_BUDGET_MS, below the platform's draining
// window. A close that fails, or a request that outlives the deadline, ends the
// process with exit code 1. srvx's own HTTP drain starts on the same signals
// when the server is created, after plugins run, with the same deadline.
//
// The `nitro` import is build-time only: Nitro's bundler inlines definePlugin
// into .output — the runtime container never resolves the package, so it
// correctly stays a devDependency (fallow override in .fallowrc.json).

import { definePlugin } from 'nitro'
import { closeContainer } from '#/composition'
import {
  beginContainerDrain,
  markContainerFailed,
} from '#/composition/container-lifecycle'
import { closeRedis } from '#/shared/cache/redis'
import { getEnv } from '#/shared/config/env'
import { closePool } from '#/shared/db/pool'
import { createWebShutdown } from '#/shared/lifecycle/graceful-shutdown'
import { getLogger } from '#/shared/observability/logger'
import { flushObservability } from '#/shared/observability/telemetry'

export default definePlugin((app) => {
  const budgetMs = getEnv().DRAIN_BUDGET_MS
  // srvx reads its drain timeout when the server is created, after this runs.
  process.env.SERVER_SHUTDOWN_TIMEOUT = String(Math.ceil(budgetMs / 1000))
  const shutdown = createWebShutdown({
    fetch: app.fetch,
    closers: [
      { name: 'container', close: closeContainer },
      { name: 'redis', close: closeRedis },
      { name: 'pg-pool', close: closePool },
      {
        name: 'error-monitoring',
        close: async () => {
          if (!(await flushObservability()))
            throw new Error('Error monitoring flush incomplete')
        },
      },
    ],
    budgetMs,
    logger: getLogger(),
    beginDrain: beginContainerDrain,
    failed: markContainerFailed,
    setExitCode: (code) => {
      process.exitCode = code
    },
    // The deadline may have ended before the monitoring flush ran: give it one
    // bounded attempt so the failure itself is reported.
    forceExit: (code) => {
      void flushObservability()
        .catch(() => false)
        .finally(() => process.exit(code))
    },
  })
  app.fetch = shutdown.fetch
  process.once('SIGTERM', () => {
    void shutdown.shutdown('SIGTERM')
  })
  process.once('SIGINT', () => {
    void shutdown.shutdown('SIGINT')
  })
  app.hooks.hook('close', () => shutdown.shutdown('close'))
})
