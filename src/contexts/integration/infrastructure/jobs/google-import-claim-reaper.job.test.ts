// Google import v2 claim-lease reaper job unit tests.
//
// The job module is the queue seam: one bounded reaper run per cadence tick
// plus one content-free log line. The defects that matter for a background
// worker are (a) the registered job name drifting from the catalogue/queue key,
// so the repeatable job never reaches a handler, (b) the staleness boundary,
// which either preempts a lease the claim path still considers live or strands
// a dead claim for another cadence, (c) the attempt-budget boundary, where an
// off-by-one either returns a row to 'pending' with no attempt left to consume
// it or terminalizes a row that still had a retry, and (d) reporting success
// after the store read failed.
//
// The real reaper (`createGoogleImportV2ClaimReaper`) is composed in with an
// in-memory store that mirrors the Postgres predicate — still 'processing',
// non-null fence, `claim_lease_expires_at <= now` (equality is expired), oldest
// lease first, bounded — so the boundary assertions exercise production
// comparison code rather than a hand-rolled stand-in.

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
import { JOB_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'
import { createGoogleImportV2ClaimReaper } from '#/contexts/integration/application/google-import-v2-claim-reaper'
import type { GoogleImportV2ClaimReaper } from '#/contexts/integration/application/google-import-v2-claim-reaper'
import {
  GOOGLE_IMPORT_ITEM_CLAIM_LEASE_MS,
  GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS,
  type GoogleImportV2Store,
} from '#/contexts/integration/application/ports/google-import-v2-store.port'
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
}>

function processing(over: Partial<ItemRow> = {}): ItemRow {
  return {
    organizationId: ORG_ID,
    itemId: STALE_ITEM_ID,
    // A first-attempt item on its original revision: the boundary values the
    // dispatch path actually writes.
    retryRevision: 0,
    claimFence: STALE_FENCE,
    attemptOrdinal: 1,
    status: 'processing',
    claimLeaseExpiresAt: LEASE_EXPIRES_AT,
    ...over,
  }
}

/**
 * In-memory store with the Postgres repository's stale-claim contract, plus
 * recording CAS ports whose outcome each test chooses.
 */
function createHarness(
  rows: readonly ItemRow[],
  now: Date,
  outcomes: Readonly<{
    release?: 'released' | 'lost'
    terminalize?: 'completed' | 'lost'
  }> = {},
) {
  const listStaleClaimItems = vi.fn<GoogleImportV2Store['listStaleClaimItems']>(
    async (at, limit) =>
      rows
        .filter(
          (row) =>
            row.status === 'processing' &&
            row.claimLeaseExpiresAt !== null &&
            row.claimLeaseExpiresAt.getTime() <= at.getTime(),
        )
        .sort(
          (left, right) =>
            (left.claimLeaseExpiresAt?.getTime() ?? 0) -
            (right.claimLeaseExpiresAt?.getTime() ?? 0),
        )
        .slice(0, limit)
        // Same projection shape as the repository: a fenceless row is dropped,
        // never handed to the reaper with a synthesized fence.
        .flatMap((row) =>
          row.claimFence === null
            ? []
            : [
                {
                  organizationId: row.organizationId,
                  itemId: row.itemId,
                  retryRevision: row.retryRevision,
                  claimFence: row.claimFence,
                  attemptOrdinal: row.attemptOrdinal,
                },
              ],
        ),
  )
  const releaseClaimForRetry = vi.fn<GoogleImportV2Store['releaseClaimForRetry']>(
    async () => outcomes.release ?? 'released',
  )
  const terminalizeItem = vi.fn<GoogleImportV2Store['terminalizeItem']>(
    async () => outcomes.terminalize ?? 'completed',
  )
  const reap = vi.fn<GoogleImportV2ClaimReaper>(
    createGoogleImportV2ClaimReaper({
      store: { listStaleClaimItems, releaseClaimForRetry, terminalizeItem },
      clock: () => now,
    }),
  )
  return {
    handler: createGoogleImportClaimReaperHandler({ reap }),
    reap,
    listStaleClaimItems,
    releaseClaimForRetry,
    terminalizeItem,
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
      now: new Date(LEASE_EXPIRES_AT.getTime() + 1),
    })
    expect(harness.terminalizeItem).not.toHaveBeenCalled()
    expect(trace).toHaveBeenCalledWith(`job.${JOB_NAME}`, expect.any(Function))
    expect(completionPayload()).toEqual({
      job: JOB_NAME,
      staleClaimsVisited: 1,
      claimsReleased: 1,
      itemsTerminalized: 0,
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

    expect(harness.listStaleClaimItems).toHaveBeenCalledWith(LEASE_EXPIRES_AT, 100)
    expect(harness.releaseClaimForRetry).toHaveBeenCalledTimes(1)
    expect(harness.releaseClaimForRetry).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: STALE_ITEM_ID, claimFence: STALE_FENCE }),
    )
    expect(harness.terminalizeItem).not.toHaveBeenCalled()
    expect(completionPayload()).toMatchObject({
      staleClaimsVisited: 1,
      claimsReleased: 1,
    })
  })

  // The attempt-budget boundary, both sides in one run: at the ceiling the row
  // must be terminalized (releasing would park it in 'pending' with no attempt
  // left to consume it), one below the ceiling it must be released.
  it('terminalizes exactly at the attempt ceiling and releases one attempt below it', async () => {
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

    expect(harness.releaseClaimForRetry).toHaveBeenCalledTimes(1)
    expect(harness.releaseClaimForRetry).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: STALE_ITEM_ID }),
    )
    expect(harness.terminalizeItem).toHaveBeenCalledTimes(1)
    expect(harness.terminalizeItem).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      itemId: LIVE_ITEM_ID,
      retryRevision: 0,
      outcomeCode: 'temporarily_unavailable',
      retainProtectedRouting: false,
      now: new Date(LEASE_EXPIRES_AT.getTime() + 1),
    })
    expect(completionPayload()).toEqual({
      job: JOB_NAME,
      staleClaimsVisited: 2,
      claimsReleased: 1,
      itemsTerminalized: 1,
      claimsLost: 0,
    })
  })

  // Degrade, never destroy: a claim renewed, completed, or replaced between the
  // lock-free scan and the write loses the CAS and is only counted.
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
      { release: 'lost', terminalize: 'lost' },
    )

    await expect(harness.handler(tick())).resolves.toBeUndefined()

    expect(completionPayload()).toEqual({
      job: JOB_NAME,
      staleClaimsVisited: 2,
      claimsReleased: 0,
      itemsTerminalized: 0,
      claimsLost: 2,
    })
  })

  it('writes nothing and reports an all-zero run when no claim is stale', async () => {
    const harness = createHarness(
      [
        // Live lease, and a pending row that never had a claim: neither is a
        // reaper candidate.
        processing({ claimLeaseExpiresAt: new Date(LEASE_EXPIRES_AT.getTime() + 1) }),
        processing({
          itemId: LIVE_ITEM_ID,
          status: 'pending',
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
    expect(harness.terminalizeItem).not.toHaveBeenCalled()
    expect(completionPayload()).toEqual({
      job: JOB_NAME,
      staleClaimsVisited: 0,
      claimsReleased: 0,
      itemsTerminalized: 0,
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

  it('rejects so the attempt retries, and logs no completion line, when the scan fails', async () => {
    const failure = new Error('import store unavailable')
    const reap = vi.fn<GoogleImportV2ClaimReaper>(async () => {
      throw failure
    })
    const handler = createGoogleImportClaimReaperHandler({ reap })

    await expect(handler(tick())).rejects.toBe(failure)

    expect(reap).toHaveBeenCalledTimes(1)
    expect(mockLogger.info).not.toHaveBeenCalled()
  })
})
