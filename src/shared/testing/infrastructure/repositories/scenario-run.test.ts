// BQC-8.1 — scenario runner integration proof (real PostgreSQL + Redis).
//
// The unit suite pins the executor contract against fakes; this suite runs
// `steady` for a few seconds through the REAL seams the CLI uses: the
// composition container's BullMQ default queue (catalogue enqueue policy),
// the composition-owned OperationsSnapshot reader, and the result/raw store
// contracts. The run must leave the shared queue exactly as it found it —
// cleanup removes the run's own job ids, never an obliterate.
//
// Skips cleanly when the local Redis is unavailable (lease contract).

import { describe, it, expect, afterAll } from 'vitest'
import { getContainer, closeContainer } from '#/composition'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import {
  acquireRedisTestLease,
  type RedisTestLease,
} from '#/shared/testing/redis-test-lease'
import {
  getScenarioExecutor,
  type ScenarioRunEnv,
} from '#/shared/testing/scenarios/executors'
import { serializeResult, parseResult } from '#/shared/testing/scenarios/catalogue'
import { viaContainer } from '#/shared/testing/ops-snapshot-capture'
import { performance } from 'node:perf_hooks'

let redisLease: RedisTestLease | undefined
let redisAvailable = false

afterAll(async () => {
  await closeContainer()
  redisLease?.release()
})

describe('steady scenario (BQC-8.1, integration)', () => {
  it('runs against the real container seams and produces a passing record', async () => {
    redisLease = await acquireRedisTestLease()
    redisAvailable = redisLease.available
    if (!redisAvailable) return

    const container = getContainer()
    const queue = container.jobQueue
    expect(queue).toBeDefined()

    const identitySnapshot = await container.operationsSnapshot.read()
    const enqueuedIds: string[] = []
    const runEnv: ScenarioRunEnv = {
      enqueue: async (jobName, data, jobId) => {
        await queue!.add(jobName, data, { ...jobEnqueueOptions(jobName), jobId })
        enqueuedIds.push(jobId)
      },
      removeJobs: async (jobIds) => {
        let removed = 0
        let missing = 0
        for (const id of jobIds) {
          try {
            await queue!.remove(id)
            removed += 1
          } catch {
            missing += 1
          }
        }
        return { removed, missing }
      },
      snapshotSource: viaContainer(container.operationsSnapshot),
      arrivalJob: {
        name: 'sync-property-reviews',
        data: (seq) => ({
          propertyId: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
          organizationId: 'perf-harness-it',
          connectionId: `00000000-0000-4000-9000-${String(seq).padStart(12, '0')}`,
          locationName: 'perf-probe',
        }),
      },
      clock: () => new Date(),
      now: () => performance.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      identity: {
        environment: 'local',
        releaseSha: identitySnapshot.release.sha,
        versions: {
          capabilityPolicy: identitySnapshot.versions.capabilityPolicy,
          policyStore: identitySnapshot.versions.policyStore,
          sourceContentPolicy: identitySnapshot.versions.sourceContentPolicy,
        },
      },
    }

    const outcome = await getScenarioExecutor('steady')!(runEnv, {
      ratePerSec: 10,
      durationS: 3,
      pollIntervalMs: 1000,
    })
    const { record, raw } = outcome

    // Samples + monitoring landed, and the record passes its own assertions.
    expect(raw.samples.length).toBeGreaterThanOrEqual(25)
    expect(record.samples.count).toBe(raw.samples.length)
    expect(record.samples.errors).toBe(0)
    expect(record.monitoring.points).toBeGreaterThanOrEqual(2)
    expect(record.passed).toBe(true)
    expect(record.metrics.removedOnCleanup).toBe(raw.samples.length)

    // The result store contract round-trips what the run wrote.
    expect(parseResult(serializeResult(record))).toEqual(record)

    // The shared queue holds none of this run's jobs afterwards.
    for (const id of enqueuedIds) {
      expect(await queue!.getJob(id)).toBeUndefined()
    }
  }, 60_000)
})
