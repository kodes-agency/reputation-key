// The worker keeps its recurring schedulers installed for its whole life.
//
// Schedulers live only in Queue Redis, which needs no persistence (ADR 0053).
// Installed once at boot, they vanished with a Redis restart while the worker
// reconnected and kept running: no digest, no repair sweep, and — because the
// health-check job is itself a scheduler — no heartbeat and no alert to say
// so. The entry point has no hermetic coverage path, so this pins its wiring
// the way the other worker wiring gates do.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const worker = readFileSync(resolve('src/worker/index.ts'), 'utf8')

describe('worker scheduler watchdog wiring', () => {
  it('watches the same scheduler plan boot reconciliation installed', () => {
    expect(worker).toMatch(
      /startJobSchedulerWatchdog\(\{\s*queue: container\.backgroundQueue,\s*desired: schedulerPlan\.desired,\s*planRecord: schedulerPlanRecord,\s*intervalMs: JOB_SCHEDULER_WATCHDOG_INTERVAL_MS,/,
    )
  })

  it('records the reconciled plan where the watchdog checks it owns the schedulers', () => {
    expect(worker).toMatch(
      /reconcileJobSchedulers\(\{\s*queue: container\.backgroundQueue,\s*managedJobNames: schedulerPlan\.managedJobNames,\s*desired: schedulerPlan\.desired,\s*planRecord: schedulerPlanRecord,/,
    )
    expect(worker).toMatch(
      /schedulerPlanRecord = runtimeObservationRedis\s*\?\s*createRedisSchedulerPlanRecord\(runtimeObservationRedis\)/,
    )
  })

  it('rebuilds the boot observations lost with the schedulers', () => {
    expect(worker).toMatch(
      /onRestored: async \(\) => \{\s*await runtimeObservationStore\?\.recordBoot\(bootObservation\)/,
    )
  })

  it('stops watching with the relay, before the drain', () => {
    const shutdown = worker.slice(worker.indexOf('const shutdown = async'))
    const stopAt = shutdown.indexOf('stopSchedulerWatchdog()')
    expect(stopAt).toBeGreaterThan(-1)
    expect(stopAt).toBeLessThan(shutdown.indexOf('drainWorkerResources('))
  })
})
