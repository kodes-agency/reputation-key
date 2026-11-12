import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fileURLToPath } from 'node:url'

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
}))

vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
}))

import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import { JOB_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'
import { createGoogleImportClaimReaper } from '#/contexts/integration/application/google-import-claim-reaper'
import type { GoogleImportClaimReaper } from '#/contexts/integration/application/google-import-claim-reaper'
import {
  GOOGLE_IMPORT_ITEM_CLAIM_LEASE_MS,
  GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS,
  type GoogleImportStore,
} from '#/contexts/integration/application/ports/google-import-store.port'
import {
  createGoogleImportClaimReaperHandler,
  JOB_NAME,
} from './google-import-claim-reaper.job'

/** Repo-relative path of the module under test, derived from this test file. */
const MODULE_PATH = fileURLToPath(import.meta.url)
  .replace(/^.*?\/src\//, 'src/')
  .replace(/\.test\.ts$/, '.ts')

const CLAIMED_AT = new Date('2026-08-20T09:00:00.000Z')
/** Sourced from the lease constant, never a pasted instant. */
const LEASE_EXPIRES_AT = new Date(
  CLAIMED_AT.getTime() + GOOGLE_IMPORT_ITEM_CLAIM_LEASE_MS,
)

const ORG_ID = '20000000-0000-4000-8000-000000000001'
const STALE_ITEM_ID = '20000000-0000-4000-8000-000000000002'
const LIVE_ITEM_ID = '20000000-0000-4000-8000-000000000003'
const STALE_FENCE = '20000000-0000-4000-8000-000000000004'
const LIVE_FENCE = '20000000-0000-4000-8000-000000000005'

type ItemRow = Readonly<{
  organizationId: string
  itemId: string
  retryRevision: number
  claimFence: string | null
  attemptOrdinal: number
  status: 'pending' | 'processing' | 'completed'
  claimLeaseExpiresAt: Date | null
  effectDeadlineAt: Date
  nextDispatchAt: Date
  dispatchEpoch: number
}>

function processing(over: Partial<ItemRow> = {}): ItemRow {
  return {
    organizationId: ORG_ID,
    itemId: STALE_ITEM_ID,
    // A first-attempt item on its original revision: the boundary values the
    // dispatch path actually writes.
    retryRevision: 0,
    dispatchEpoch: 0,
    nextDispatchAt: LEASE_EXPIRES_AT,
    claimFence: STALE_FENCE,
    attemptOrdinal: 1,
    status: 'processing',
    claimLeaseExpiresAt: LEASE_EXPIRES_AT,
    // Well past every instant these tests run at: a retry is still allowed.
    effectDeadlineAt: new Date(CLAIMED_AT.getTime() + 24 * 60 * 60 * 1_000),
    ...over,
  }
}

/** The job boundary supplies a bounded reservation and records recovery effects. */
function createHarness(
  rows: readonly ItemRow[],
  now: Date,
  outcomes: Readonly<{ release?: 'released' | 'lost' }> = {},
) {
  const reserveDueItems = vi.fn<GoogleImportStore['reserveDueItems']>(async (at, limit) =>
    rows
      .filter(
        (row) =>
          row.status !== 'completed' &&
          row.nextDispatchAt <= at &&
          (row.status === 'pending' ||
            (row.claimLeaseExpiresAt !== null && row.claimLeaseExpiresAt <= at)),
      )
      .sort(
        (left, right) => left.nextDispatchAt.getTime() - right.nextDispatchAt.getTime(),
      )
      .slice(0, limit)
      .flatMap((row) =>
        row.status === 'completed'
          ? []
          : [
              {
                organizationId: row.organizationId,
                importJobId: 'parent-import',
                itemId: row.itemId,
                retryRevision: row.retryRevision,
                dispatchEpoch: row.dispatchEpoch,
                status: row.status,
                claimFence: row.claimFence,
                attemptOrdinal: row.attemptOrdinal,
                effectDeadlineAt: row.effectDeadlineAt,
                expectedConnectionLifecycleVersion: 1,
                expectedSourceEpoch: null,
              },
            ],
      ),
  )
  const releaseClaimForRetry = vi.fn<GoogleImportStore['releaseClaimForRetry']>(
    async () => outcomes.release ?? 'released',
  )
  const processItem = vi.fn(async () => undefined)
  const addImportItemJobs = vi.fn(async () => undefined)
  const reap = vi.fn<GoogleImportClaimReaper>(
    createGoogleImportClaimReaper({
      store: { reserveDueItems, releaseClaimForRetry },
      processItem,
      queue: { addImportItemJobs },
      clock: () => now,
      newDeliveryId: () => '20000000-0000-4000-8000-000000000006',
      logger: mockLogger,
    }),
  )
  return {
    handler: createGoogleImportClaimReaperHandler({ reap, logger: mockLogger }),
    reap,
    reserveDueItems,
    releaseClaimForRetry,
    processItem,
    addImportItemJobs,
  }
}

const tick = (data: unknown = {}) => ({ data }) as unknown as Job

/** The single completion line the cadence emits per run. */
function completionPayload(): Record<string, unknown> {
  expect(mockLogger.info).toHaveBeenCalledTimes(1)
  return mockLogger.info.mock.calls[0]?.[0] as Record<string, unknown>
}

describe('google import claim-lease reaper job', () => {
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

  it('releases a stale claim through the CAS helper while attempts remain', async () => {
    const harness = createHarness(
      [processing({ attemptOrdinal: GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS - 1 })],
      new Date(LEASE_EXPIRES_AT.getTime() + 1),
    )

    await expect(harness.handler(tick())).resolves.toBeUndefined()

    expect(harness.releaseClaimForRetry).toHaveBeenCalledTimes(1)
    expect(harness.releaseClaimForRetry).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      itemId: STALE_ITEM_ID,
      retryRevision: 0,
      claimFence: STALE_FENCE,
      dispatchEpoch: 0,
      expiredOnly: true,
      now: new Date(LEASE_EXPIRES_AT.getTime() + 1),
    })
    expect(harness.processItem).not.toHaveBeenCalled()
    expect(harness.addImportItemJobs).toHaveBeenCalledWith([
      expect.objectContaining({ itemId: STALE_ITEM_ID, dispatchEpoch: 1 }),
    ])
    expect(trace).toHaveBeenCalledWith(`job.${JOB_NAME}`, expect.any(Function))
    expect(completionPayload()).toEqual({
      job: JOB_NAME,
      dueItemsVisited: 1,
      claimsReleased: 1,
      completionChecks: 0,
      itemsDispatched: 1,
      itemFailures: 0,
      claimsLost: 0,
    })
  })

  // The staleness boundary. Equality is expired (`claim_lease_expires_at <=
  // now`), the same instant the claim path stops treating the lease as live, so
  // a claim exactly at expiry is reaped this tick while a claim with one
  // millisecond left is not touched at all.
  it('reaps a claim exactly at lease expiry and leaves one with a millisecond left alone', async () => {
    const harness = createHarness(
      [
        processing(),
        processing({
          itemId: LIVE_ITEM_ID,
          claimFence: LIVE_FENCE,
          claimLeaseExpiresAt: new Date(LEASE_EXPIRES_AT.getTime() + 1),
        }),
      ],
      LEASE_EXPIRES_AT,
    )

    await harness.handler(tick())

    expect(harness.reserveDueItems).toHaveBeenCalledWith(LEASE_EXPIRES_AT, 100)
    expect(harness.releaseClaimForRetry).toHaveBeenCalledTimes(1)
    expect(harness.releaseClaimForRetry).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: STALE_ITEM_ID, claimFence: STALE_FENCE }),
    )
    expect(harness.processItem).not.toHaveBeenCalled()
    expect(completionPayload()).toMatchObject({
      dueItemsVisited: 1,
      claimsReleased: 1,
    })
  })

  // Exhausted work needs receipt reconciliation through the processor;
  // work with an attempt left can return through the queue.
  it('runs receipt-aware processing at the attempt ceiling and dispatches one attempt below it', async () => {
    const harness = createHarness(
      [
        processing({ attemptOrdinal: GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS - 1 }),
        processing({
          itemId: LIVE_ITEM_ID,
          claimFence: LIVE_FENCE,
          attemptOrdinal: GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS,
          claimLeaseExpiresAt: new Date(LEASE_EXPIRES_AT.getTime() + 1),
        }),
      ],
      new Date(LEASE_EXPIRES_AT.getTime() + 1),
    )

    await harness.handler(tick())

    expect(harness.releaseClaimForRetry).toHaveBeenCalledTimes(2)
    expect(harness.releaseClaimForRetry).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: STALE_ITEM_ID }),
    )
    expect(harness.processItem).toHaveBeenCalledTimes(1)
    expect(harness.processItem).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      itemId: LIVE_ITEM_ID,
      retryRevision: 0,
      dispatchEpoch: 1,
      attemptOrdinal: 1,
    })
    expect(completionPayload()).toEqual({
      job: JOB_NAME,
      dueItemsVisited: 2,
      claimsReleased: 2,
      completionChecks: 1,
      itemsDispatched: 1,
      itemFailures: 0,
      claimsLost: 0,
    })
  })

  // A claim completed or replaced after reservation loses the fenced release.
  it('counts a lost CAS on both recovery paths without failing the run', async () => {
    const harness = createHarness(
      [
        processing(),
        processing({
          itemId: LIVE_ITEM_ID,
          claimFence: LIVE_FENCE,
          attemptOrdinal: GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS,
        }),
      ],
      new Date(LEASE_EXPIRES_AT.getTime() + 1),
      { release: 'lost' },
    )

    await expect(harness.handler(tick())).resolves.toBeUndefined()

    expect(completionPayload()).toEqual({
      job: JOB_NAME,
      dueItemsVisited: 2,
      claimsReleased: 0,
      completionChecks: 0,
      itemsDispatched: 0,
      itemFailures: 0,
      claimsLost: 2,
    })
  })

  it('writes nothing and reports an all-zero run when no claim is stale', async () => {
    const harness = createHarness(
      [
        // A live lease and a future pending appointment are both left alone.
        processing({ claimLeaseExpiresAt: new Date(LEASE_EXPIRES_AT.getTime() + 1) }),
        processing({
          itemId: LIVE_ITEM_ID,
          status: 'pending',
          nextDispatchAt: new Date(LEASE_EXPIRES_AT.getTime() + 1),
          claimFence: null,
          attemptOrdinal: 0,
          claimLeaseExpiresAt: null,
        }),
      ],
      LEASE_EXPIRES_AT,
    )

    // The repeatable job enqueues `{}`; a stray payload must not stop the reap.
    await expect(harness.handler(tick({ unexpected: true }))).resolves.toBeUndefined()

    expect(harness.releaseClaimForRetry).not.toHaveBeenCalled()
    expect(harness.processItem).not.toHaveBeenCalled()
    expect(completionPayload()).toEqual({
      job: JOB_NAME,
      dueItemsVisited: 0,
      claimsReleased: 0,
      completionChecks: 0,
      itemsDispatched: 0,
      itemFailures: 0,
      claimsLost: 0,
    })
  })

  // Counts only: no organization, item, property, provider identifier, or claim
  // fence may reach a log line.
  it('never writes a tenant, item, or fence identifier into the completion line', async () => {
    const harness = createHarness([processing()], LEASE_EXPIRES_AT)

    await harness.handler(tick())

    const serialized = JSON.stringify(completionPayload())
    for (const identifier of [ORG_ID, STALE_ITEM_ID, STALE_FENCE]) {
      expect(serialized).not.toContain(identifier)
    }
  })

  it.each([0, 1])(
    'keeps the logger receiver and selects warning only for item failures (%s)',
    async (itemFailures) => {
      const info = vi.fn()
      const warn = vi.fn()
      const logger: LoggerPort = {
        ...mockLogger,
        info(fields) {
          expect(this).toBe(logger)
          info(fields)
        },
        warn(fields) {
          expect(this).toBe(logger)
          warn(fields)
        },
      }
      const reap = vi.fn<GoogleImportClaimReaper>(async () => ({
        dueItemsVisited: 3,
        claimsReleased: 1,
        itemsDispatched: 1,
        completionChecks: 0,
        claimsLost: 1,
        itemFailures,
      }))
      await createGoogleImportClaimReaperHandler({ reap, logger })(tick())
      expect(itemFailures === 0 ? info : warn).toHaveBeenCalledWith({
        job: JOB_NAME,
        dueItemsVisited: 3,
        claimsReleased: 1,
        itemsDispatched: 1,
        completionChecks: 0,
        claimsLost: 1,
        itemFailures,
      })
      expect(itemFailures === 0 ? warn : info).not.toHaveBeenCalled()
    },
  )

  it('rejects so the attempt retries, and logs no completion line, when the scan fails', async () => {
    const failure = new Error('import store unavailable')
    const reap = vi.fn<GoogleImportClaimReaper>(async () => {
      throw failure
    })
    const handler = createGoogleImportClaimReaperHandler({
      reap,
      logger: mockLogger,
    })

    await expect(handler(tick())).rejects.toBe(failure)

    expect(reap).toHaveBeenCalledTimes(1)
    expect(mockLogger.info).not.toHaveBeenCalled()
  })
})
