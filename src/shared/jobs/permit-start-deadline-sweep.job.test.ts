// Execution-permit start-deadline sweep job unit tests.
//
// The job module is the queue seam: one bounded sweeper run per cadence tick
// plus one content-free log line. What a background worker can actually get
// wrong here is (a) the registered job name drifting from the catalogue/queue
// key, so the repeatable job never reaches a handler, (b) the deadline
// boundary, which either leaks permits (pinning `approval_binding_id` forever)
// or fences permits a caller could still legally start, (c) swallowing a store
// failure so the run reports success, and (d) leaking a permit/org identifier
// into the log line.
//
// The real sweeper (`createExecutionPermitStartDeadlineSweeper`) is composed in
// with an in-memory store that mirrors the Postgres repository predicates
// (`state = 'admitted' AND start_deadline_at < before`, oldest first, bounded),
// so the boundary assertions below exercise production comparison code rather
// than a hand-rolled stand-in.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fileURLToPath } from 'node:url'

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('#/shared/observability/logger', () => ({
  getLogger: vi.fn(() => mockLogger),
}))
vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
}))

import type { Job } from 'bullmq'
import { trace } from '#/shared/observability/trace'
import {
  AUTHORIZATION_PERMIT_START_DEADLINE_MS,
  createAdmittedExecutionPermit,
  fenceElapsedStartDeadlinePermit,
  type AdmitAuthorizationExecutionPermitInput,
  type AuthorizationExecutionPermit,
} from '#/shared/auth/authorization-execution-permit'
import {
  createExecutionPermitStartDeadlineSweeper,
  type ExecutionPermitStartDeadlineSweepStore,
  type ExecutionPermitStartDeadlineSweeper,
} from '#/shared/auth/execution-permit-start-deadline-sweep'
import { JOB_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'
import {
  createPermitStartDeadlineSweepHandler,
  JOB_NAME,
} from './permit-start-deadline-sweep.job'

/** Repo-relative path of the module under test, derived from this test file. */
const MODULE_PATH = fileURLToPath(import.meta.url)
  .replace(/^.*?\/src\//, 'src/')
  .replace(/\.test\.ts$/, '.ts')

const ADMITTED_AT = new Date('2026-08-20T09:00:00.000Z')
/** Sourced from the domain constant, never a pasted instant. */
const DEADLINE_AT = new Date(
  ADMITTED_AT.getTime() + AUTHORIZATION_PERMIT_START_DEADLINE_MS,
)
const ONE_MS_PAST_DEADLINE = new Date(DEADLINE_AT.getTime() + 1)

const ORG_ID = '10000000-0000-4000-8000-000000000001'
const PROPERTY_ID = '10000000-0000-4000-8000-000000000002'
const APPROVAL_BINDING_ID = '10000000-0000-4000-8000-000000000003'
const ELAPSED_ID = 'permit-elapsed'
const VANISHED_ID = 'permit-vanished'

function admitted(id: string): AuthorizationExecutionPermit {
  const input: AdmitAuthorizationExecutionPermitInput = {
    id,
    capability: 'property.read_gbp_performance',
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    // Production shape for an unscoped admission: optional bindings are null.
    connectionId: null,
    initiatorUserId: null,
    operationKey: 'performance-report',
    routeKey: 'performance.multi-daily-metrics',
    routeCatalogVersion: '2026-08-16',
    quotaPolicyId: 'google-performance-v1',
    policyVersion: 1,
    emergencyKillVersion: 1,
    approvalBindingId: APPROVAL_BINDING_ID,
    permitGeneration: 1,
    startVectorMode: 'full',
    commitVectorMode: 'full',
  }
  return createAdmittedExecutionPermit(input, ADMITTED_AT)
}

/**
 * In-memory store with the Postgres repository's contract: the candidate scan
 * is `capability IN (...) AND state = 'admitted' AND start_deadline_at <
 * before`, oldest deadline first, bounded by `limit`; `lockPermit` re-reads the
 * row under lock, so `lockAs` models a row that moved on between the lock-free
 * scan and the locked re-read and `vanish` models a deleted row.
 */
function createHarness(
  rows: readonly AuthorizationExecutionPermit[],
  startAt: Date,
  options: Readonly<{
    lockAs?: ReadonlyMap<string, AuthorizationExecutionPermit>
    vanish?: readonly string[]
  }> = {},
) {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const vanished = new Set(options.vanish ?? [])
  const updates: AuthorizationExecutionPermit[] = []
  let now = startAt

  const store: ExecutionPermitStartDeadlineSweepStore<'tx'> = {
    transaction: (run) => run('tx'),
    listElapsedAdmittedPermitIds: async (_tx, input) =>
      [...byId.values()]
        .filter(
          (row) =>
            input.capabilities.includes(row.capability) &&
            row.state === 'admitted' &&
            row.startDeadlineAt.getTime() < input.before.getTime(),
        )
        .sort(
          (left, right) =>
            left.startDeadlineAt.getTime() - right.startDeadlineAt.getTime(),
        )
        .slice(0, input.limit)
        .map((row) => row.id),
    lockPermit: async (_tx, id) => {
      if (vanished.has(id)) return null
      const locked = options.lockAs?.get(id) ?? byId.get(id)
      return locked ? { permit: locked } : null
    },
    updatePermit: async (_tx, permit) => {
      byId.set(permit.id, permit)
      updates.push(permit)
    },
  }

  const sweep = vi.fn<ExecutionPermitStartDeadlineSweeper>(
    createExecutionPermitStartDeadlineSweeper({ store, clock: () => now }),
  )
  return {
    handler: createPermitStartDeadlineSweepHandler({ sweep }),
    sweep,
    byId,
    updates,
    setNow: (next: Date) => {
      now = next
    },
  }
}

const tick = (data: unknown = {}) => ({ data }) as unknown as Job

/** The single completion line the cadence emits per run. */
function completionPayload(): Record<string, unknown> {
  expect(mockLogger.info).toHaveBeenCalledTimes(1)
  return mockLogger.info.mock.calls[0]?.[0] as Record<string, unknown>
}

describe('permit start-deadline sweep job', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // A renamed constant silently orphans the repeatable job: the worker enqueues
  // under the module's name while the registry/catalogue expects another.
  it('carries the job name the job-family catalogue pins to this module', () => {
    expect(JOB_FAMILY_ROWS.filter((row) => row.processor === MODULE_PATH)).toEqual([
      expect.objectContaining({ jobName: JOB_NAME }),
    ])
    expect(JOB_FAMILY_ROWS.filter((row) => row.jobName === JOB_NAME)).toHaveLength(1)
  })

  it('fences an admitted permit whose start deadline is strictly past', async () => {
    const harness = createHarness([admitted(ELAPSED_ID)], ONE_MS_PAST_DEADLINE)

    await expect(harness.handler(tick())).resolves.toBeUndefined()

    expect(harness.sweep).toHaveBeenCalledTimes(1)
    expect(harness.updates).toHaveLength(1)
    expect(harness.byId.get(ELAPSED_ID)).toMatchObject({
      state: 'fenced',
      fencedAt: ONE_MS_PAST_DEADLINE,
    })
    expect(trace).toHaveBeenCalledWith(`job.${JOB_NAME}`, expect.any(Function))
    expect(completionPayload()).toEqual({
      job: JOB_NAME,
      scanned: 1,
      fenced: 1,
      vanished: 0,
      retainedStateNotAdmitted: 0,
      retainedStartDeadlinePending: 0,
      batchFull: false,
    })
  })

  // Counts and reason codes only: no permit id, capability, organization,
  // property, or approval binding may reach a log line.
  it('never writes a permit or tenant identifier into the completion line', async () => {
    const harness = createHarness([admitted(ELAPSED_ID)], ONE_MS_PAST_DEADLINE)

    await harness.handler(tick())

    const serialized = JSON.stringify(completionPayload())
    for (const identifier of [
      ELAPSED_ID,
      ORG_ID,
      PROPERTY_ID,
      APPROVAL_BINDING_ID,
      'property.read_gbp_performance',
    ]) {
      expect(serialized).not.toContain(identifier)
    }
  })

  // The boundary. The bounded candidate scan is `start_deadline_at < before`,
  // so a permit sitting exactly on its deadline is NOT selected by this tick —
  // it is fenced by the next one, one millisecond later. The domain helper,
  // meanwhile, treats equality as elapsed (matching `startExecutionPermit`), so
  // the retention below must come from the scan cutoff and nothing else. An
  // off-by-one in either layer flips one of these three assertions.
  it('leaves a permit exactly at its start deadline for the next tick, then fences it', async () => {
    const permit = admitted(ELAPSED_ID)
    const harness = createHarness([permit], DEADLINE_AT)

    await harness.handler(tick())

    expect(harness.updates).toEqual([])
    expect(harness.byId.get(ELAPSED_ID)).toMatchObject({
      state: 'admitted',
      fencedAt: null,
    })
    expect(completionPayload()).toMatchObject({ scanned: 0, fenced: 0 })

    // Equality IS elapsed for the fence rule; only the scan cutoff held it back.
    expect(fenceElapsedStartDeadlinePermit(permit, DEADLINE_AT)).toMatchObject({
      kind: 'fenced',
      reason: 'start_deadline_elapsed',
    })

    mockLogger.info.mockClear()
    harness.setNow(ONE_MS_PAST_DEADLINE)
    await harness.handler(tick())

    expect(harness.byId.get(ELAPSED_ID)).toMatchObject({
      state: 'fenced',
      fencedAt: ONE_MS_PAST_DEADLINE,
    })
    expect(completionPayload()).toMatchObject({ scanned: 1, fenced: 1 })
  })

  it('writes nothing and reports an all-zero run when the scan finds no candidate', async () => {
    const harness = createHarness([], ONE_MS_PAST_DEADLINE)

    // The repeatable job enqueues `{}`; a stray payload must not stop the sweep.
    await expect(harness.handler(tick({ unexpected: true }))).resolves.toBeUndefined()

    expect(harness.updates).toEqual([])
    expect(completionPayload()).toEqual({
      job: JOB_NAME,
      scanned: 0,
      fenced: 0,
      vanished: 0,
      retainedStateNotAdmitted: 0,
      retainedStartDeadlinePending: 0,
      batchFull: false,
    })
  })

  // Degrade, never destroy: a candidate that started (or disappeared) between
  // the lock-free scan and the locked re-read is retained/counted, never
  // force-fenced, and the run still completes.
  it('retains a candidate that started between scan and lock and counts a vanished row', async () => {
    const started = {
      ...admitted(ELAPSED_ID),
      state: 'started' as const,
      startedAt: DEADLINE_AT,
    }
    const harness = createHarness(
      [admitted(ELAPSED_ID), admitted(VANISHED_ID)],
      ONE_MS_PAST_DEADLINE,
      { lockAs: new Map([[ELAPSED_ID, started]]), vanish: [VANISHED_ID] },
    )

    await expect(harness.handler(tick())).resolves.toBeUndefined()

    expect(harness.updates).toEqual([])
    expect(harness.byId.get(ELAPSED_ID)).toMatchObject({ state: 'admitted' })
    expect(completionPayload()).toEqual({
      job: JOB_NAME,
      scanned: 2,
      fenced: 0,
      vanished: 1,
      retainedStateNotAdmitted: 1,
      retainedStartDeadlinePending: 0,
      batchFull: false,
    })
  })

  it('rejects so the attempt retries, and logs no completion line, when the sweep fails', async () => {
    const failure = new Error('permit store unavailable')
    const sweep = vi.fn<ExecutionPermitStartDeadlineSweeper>(async () => {
      throw failure
    })
    const handler = createPermitStartDeadlineSweepHandler({ sweep })

    await expect(handler(tick())).rejects.toBe(failure)

    expect(sweep).toHaveBeenCalledTimes(1)
    expect(mockLogger.info).not.toHaveBeenCalled()
  })
})
