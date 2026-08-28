// Property AI trend scheduler job unit tests.
//
// This job is the minutely queue seam for the trend scheduler: it validates the
// (empty) repeatable payload, mints a fresh lease owner, and delegates. What a
// background worker can get wrong here is (a) the registered job name drifting
// from the catalogue/queue key so the repeatable job never reaches a handler,
// (b) reusing a lease owner across ticks, which lets two runs steal each other's
// scheduler lease, (c) treating a held lease ('busy') as a failure and retrying
// against a run already in flight, and (d) swallowing a store failure so a tick
// silently schedules nothing.
//
// Registration is capability-gated in bootstrap (`registerCapabilityGatedJob`),
// so the denial branch is asserted through the real gate predicate
// `isCapabilityJobEnabled` with the capability the catalogue declares for this
// module — not a retyped literal.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import type { Job } from 'bullmq'
import { isCapabilityJobEnabled } from '#/shared/auth/beta-capabilities'
import { JOB_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'
import type { SchedulePropertyTrendsResult } from '#/contexts/ai/application/use-cases/schedule-property-trends'
import {
  createSchedulePropertyTrendsJobHandler,
  SCHEDULE_PROPERTY_TRENDS_JOB_NAME,
  type SchedulePropertyTrendsJobDependencies,
} from './schedule-property-trends.job'

/** Repo-relative path of the module under test, derived from this test file. */
const MODULE_PATH = fileURLToPath(import.meta.url)
  .replace(/^.*?\/src\//, 'src/')
  .replace(/\.test\.ts$/, '.ts')

const catalogueRows = JOB_FAMILY_ROWS.filter((row) => row.processor === MODULE_PATH)
const catalogueRow = catalogueRows[0]
if (!catalogueRow || catalogueRow.capability === 'none') {
  throw new Error(`no capability-gated job-family row for ${MODULE_PATH}`)
}
/** The gate bootstrap consults before registering this job's real handler. */
const JOB_CAPABILITY = catalogueRow.capability

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** An empty batch on the first generation — the boundary a quiet tick produces. */
const EMPTY_SCHEDULED: SchedulePropertyTrendsResult = {
  status: 'scheduled',
  schedulerGeneration: 0,
  scheduledCount: 0,
  hasMore: false,
}

function createHarness(result: SchedulePropertyTrendsResult = EMPTY_SCHEDULED) {
  const leaseOwners = [
    '31000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000002',
  ]
  let leaseOwnerIndex = 0
  const idGen = vi.fn(() => leaseOwners[leaseOwnerIndex++]!)
  const schedulePropertyTrends = vi.fn<
    SchedulePropertyTrendsJobDependencies['schedulePropertyTrends']
  >(async () => result)
  return {
    handler: createSchedulePropertyTrendsJobHandler({ idGen, schedulePropertyTrends }),
    idGen,
    schedulePropertyTrends,
  }
}

const tick = (data: unknown = {}) => ({ data }) as unknown as Job

describe('schedule property AI trends job', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    delete process.env.RESTORE_MODE
  })

  // A renamed constant silently orphans the repeatable job: the worker enqueues
  // under the module's name while the registry/catalogue expects another.
  it('carries the job name the job-family catalogue pins to this module', () => {
    expect(catalogueRows).toEqual([
      expect.objectContaining({ jobName: SCHEDULE_PROPERTY_TRENDS_JOB_NAME }),
    ])
    expect(
      JOB_FAMILY_ROWS.filter((row) => row.jobName === SCHEDULE_PROPERTY_TRENDS_JOB_NAME),
    ).toHaveLength(1)
  })

  it('schedules the due batch once per tick under a fresh lease owner', async () => {
    const harness = createHarness()

    await expect(harness.handler(tick())).resolves.toBeUndefined()

    expect(harness.schedulePropertyTrends).toHaveBeenCalledTimes(1)
    const [input] = harness.schedulePropertyTrends.mock.calls[0] ?? []
    expect(input?.leaseOwner).toMatch(UUID_RE)
  })

  // Two ticks sharing a lease owner could steal each other's scheduler lease:
  // the owner is the only thing distinguishing concurrent runs.
  it('mints a distinct lease owner for every tick', async () => {
    const harness = createHarness()

    await harness.handler(tick())
    await harness.handler(tick())

    const owners = harness.schedulePropertyTrends.mock.calls.map(
      ([input]) => input.leaseOwner,
    )
    expect(owners).toHaveLength(2)
    expect(new Set(owners).size).toBe(2)
  })

  // A held lease means another run owns the batch. That is not a failure: a
  // rejection here would make BullMQ retry straight into the live run.
  it('completes quietly when the scheduler lease is already held', async () => {
    const harness = createHarness({ status: 'busy' })

    await expect(harness.handler(tick())).resolves.toBeUndefined()

    expect(harness.schedulePropertyTrends).toHaveBeenCalledTimes(1)
  })

  // Fail closed on payload drift: the repeatable job enqueues `{}`, so anything
  // else means the enqueue contract changed. Running with silently ignored
  // fields would schedule the wrong work under a valid-looking tick.
  it.each([
    ['an unexpected field', { propertyId: 'prop-1' }],
    ['a missing payload', undefined],
    ['a non-object payload', 'schedule'],
  ])('refuses to schedule anything given %s', async (_label, data) => {
    const harness = createHarness()

    // Built inline: `tick`'s default would substitute a valid empty payload.
    await expect(harness.handler({ data } as unknown as Job)).rejects.toThrow(
      /invalid_type|unrecognized_keys|Invalid input/,
    )

    expect(harness.schedulePropertyTrends).not.toHaveBeenCalled()
  })

  it('propagates a scheduler failure so the attempt retries', async () => {
    const failure = new Error('trend schedule store unavailable')
    const schedulePropertyTrends = vi.fn<
      SchedulePropertyTrendsJobDependencies['schedulePropertyTrends']
    >(async () => {
      throw failure
    })
    const handler = createSchedulePropertyTrendsJobHandler({
      idGen: () => '31000000-0000-4000-8000-000000000001',
      schedulePropertyTrends,
    })

    await expect(handler(tick())).rejects.toBe(failure)
  })

  // Registration gate: bootstrap registers a no-op instead of this handler when
  // the capability is dark/blocked, and restore-isolated mode denies every
  // capability at that seam. The gate must fail closed — a dark tick that still
  // scheduled trend work would be an external effect from a restored instance.
  it('is not registered, and schedules nothing, while the capability gate denies', async () => {
    const harness = createHarness()
    expect(isCapabilityJobEnabled(JOB_CAPABILITY)).toBe(true)

    process.env.RESTORE_MODE = 'isolated'
    expect(isCapabilityJobEnabled(JOB_CAPABILITY)).toBe(false)

    // Mirror of bootstrap's registerCapabilityGatedJob: the gate decides, the
    // handler never runs.
    if (isCapabilityJobEnabled(JOB_CAPABILITY)) await harness.handler(tick())

    expect(harness.schedulePropertyTrends).not.toHaveBeenCalled()
  })
})
