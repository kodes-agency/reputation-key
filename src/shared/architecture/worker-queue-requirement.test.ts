// A worker with no job queue does not start.
//
// The worker entry used to describe a degraded start: "No Redis available —
// default worker not started" and "No background queue available — cron jobs
// not scheduled". Neither line could be logged. The container the worker has
// just built throws without a default queue (Integration and Review both need
// it to enqueue), and in the worker both queues exist exactly when Redis does.
// An operator reading the entry point concluded the opposite of what the
// process does.
//
// The first case runs the container build with the worker's own options and no
// Redis, so the claim is executed and not read. The second pins the entry
// point, which has no hermetic coverage path, the way the other worker wiring
// gates do.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createContainer } from '#/composition'
import type { Database } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { clearTestContainerEnv } from '#/shared/testing/clear-container-env'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'

const worker = readFileSync(resolve('src/worker/index.ts'), 'utf8')

/** Construction is query-free, so any database access here is a failure. */
const untouchedDatabase = new Proxy(
  {},
  {
    get: () => {
      throw new Error('composition must not query the DB during construction')
    },
  },
) as unknown as Database

beforeEach(() => {
  clearTestContainerEnv()
  clearEventSchemas()
})

describe('worker queue requirement', () => {
  it('cannot build its container without a default job queue', () => {
    expect(
      () =>
        createContainer({
          // What src/worker/index.ts passes, on a host where Redis is absent.
          enableJobs: true,
          redis: undefined,
          db: untouchedDatabase,
          identityPort: createInMemoryIdentityPort(),
          email: async () => {},
        }),
      // Integration is built first and answers "jobQueue required"; Review
      // answers "jobQueue is required to build review context" behind it.
    ).toThrow(/^jobQueue (?:is )?required/)
  })

  it('describes no start without its queues', () => {
    expect(worker).not.toContain('default worker not started')
    expect(worker).not.toContain('cron jobs not scheduled')
  })

  it('refuses by name before it starts a worker on either queue', () => {
    const refusal = worker.indexOf(
      "throw new Error('[WORKER] the default and background job queues are required')",
    )
    expect(refusal).toBeGreaterThan(-1)
    expect(worker.slice(0, refusal)).toMatch(
      /if \(!container\.jobQueue \|\| !container\.backgroundQueue\) \{\s*$/,
    )
    expect(refusal).toBeLessThan(worker.indexOf("createJobWorker(\n    'default',"))
    expect(refusal).toBeLessThan(worker.indexOf("createJobWorker(\n    'background',"))
  })
})
