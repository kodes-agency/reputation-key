// Nitro plugin: app-level graceful shutdown for the web process (BQC-7.1).
//
// Registered explicitly via the `plugins` array in vite.config.ts (Nitro
// serverDir scanning stays off under TanStack Start — see the STD-P1-07 note
// on the inert security-headers plugin — so only this plugin is wired).
//
// Why this exists: the built server entry (nitro node-server preset) drains
// HTTP through srvx's graceful plugin (5s in-flight budget) but never closes
// app resources, and nothing invokes Nitro's `close` runtime hook. The pg
// pool / Redis / BullMQ queue connections keep the event loop alive, so
// SIGTERM previously ended only with the platform's SIGKILL after
// drainingSeconds. This plugin closes those resources (3s budget each) so
// the process exits naturally within the drain window. It does not call
// process.exit — srvx's HTTP drain runs in parallel and owns request
// completion.

// The `nitro` import is build-time only: Nitro's bundler inlines definePlugin
// into .output — the runtime container never resolves the package, so it
// correctly stays a devDependency (fallow override in .fallowrc.json).

import { definePlugin } from 'nitro'
import { closeContainer } from '#/composition'
import { closeRedis } from '#/shared/cache/redis'
import { closePool } from '#/shared/db/pool'
import { closeWebResources } from '#/shared/lifecycle/graceful-shutdown'
import { getLogger } from '#/shared/observability/logger'
import { flushObservability } from '#/shared/observability/telemetry'

const CLOSE_BUDGET_MS = 3_000

export default definePlugin(() => {
  const cleanup = (signal: string) => {
    const logger = getLogger()
    logger.info({ signal }, 'Shutdown signal received, closing app resources')
    void closeWebResources(
      [
        // ARC-03-T6: closeContainer runs the container's own shutdown seam
        // (identity policy poller and any future container-owned background
        // work) BEFORE detaching the BullMQ queues, so the web process no
        // longer leaves a live policy-refresh interval behind on SIGTERM.
        { name: 'container-shutdown', close: closeContainer },
        { name: 'redis', close: closeRedis },
        { name: 'pg-pool', close: closePool },
        {
          name: 'error-monitoring',
          close: async () => {
            if (!(await flushObservability())) {
              throw new Error('Error monitoring flush incomplete')
            }
          },
        },
      ],
      { budgetMs: CLOSE_BUDGET_MS, logger },
    ).then((failures) => {
      if (failures.length > 0) {
        logger.error({ failures }, 'Graceful shutdown finished with unclean resources')
      } else {
        logger.info('Graceful shutdown resource cleanup complete')
      }
    })
  }

  process.once('SIGTERM', () => cleanup('SIGTERM'))
  process.once('SIGINT', () => cleanup('SIGINT'))
})
