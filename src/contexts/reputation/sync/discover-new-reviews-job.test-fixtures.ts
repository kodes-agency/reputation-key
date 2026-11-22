// Shared builders for the discovery sweep integration suites.

import { vi } from 'vitest'
import type {
  AddSyncJobOptions,
  ReviewHeadCheckJobData,
  ReviewHeadCheckQueuePort,
  ReviewQueuePort,
  SyncPropertyReviewsJobData,
} from './review-queue.port.server'
import type { ReviewHeadChecksMode } from '../domain/head-check'
import {
  discoveryProperty,
  type DiscoveryPropertyFixture,
  type setupDiscoveryDb,
} from '#/shared/testing/review-discovery-fixtures'
import { createDiscoverNewReviewsHandler } from './discover-new-reviews-job.server'

export const NOW = new Date('2026-08-21T12:00:00.000Z')
export const MINUTE = 60 * 1000
export const HOUR = 60 * MINUTE
export const ago = (ms: number) => new Date(NOW.getTime() - ms)
export const HOT = { lastNewReviewAt: NOW }

export const prop = (n: number, over: Partial<DiscoveryPropertyFixture> = {}) =>
  discoveryProperty({
    propertyId: `aa000000-0000-4000-8000-00000000000${n}`,
    connectionId: `bb000000-0000-4000-8000-00000000000${n}`,
    gbpLocationId: `location-${n}`,
    ...over,
  })

// Composed, never written out: a literal `accounts/…/locations/…` in a test
// file fails scripts/check-google-provider-identifiers.mjs, which confines
// provider resource literals to the generated fixture catalogue.
export const expectedLocationName = (n: number) =>
  `accounts/${prop(n).gbpAccountId}/locations/${prop(n).gbpLocationId}`

export type HeadCall = Readonly<{
  data: ReviewHeadCheckJobData
  options: Parameters<ReviewHeadCheckQueuePort['addHeadCheckJob']>[1]
}>

/** The "sweep finished" log payload of the first (only) run. */
export const finishedLog = (result: {
  logger: { info: { mock: { calls: unknown[][] } } }
}): Record<string, unknown> =>
  (result.logger.info.mock.calls.find(
    ([, message]) => message === 'Discover new reviews sweep finished',
  )?.[0] ?? {}) as Record<string, unknown>

type SweepOptions = {
  failEnqueue?: boolean
  batchSize?: number
  maxBatches?: number
  intervalMs?: number
  spreadWindowMs?: number
  clock?: () => Date
  skipRecentlyReconciled?: boolean
}

type HeadSweepOptions = {
  headChecks?: ReviewHeadChecksMode
  withQueue?: boolean
  failHeadEnqueue?: boolean
  skipRecentlyReconciled?: boolean
  spreadWindowMs?: number
  reconcileWithinMs?: number
  clock?: () => Date
  batchSize?: number
}

/** Sweep builders bound to the calling suite's own database harness. */
export function sweepHarness(discoveryDb: ReturnType<typeof setupDiscoveryDb>) {
  /** What the repository stored for the fixture's Property. */
  const stored = (row: DiscoveryPropertyFixture | undefined) => {
    if (!row) throw new Error('the test seeded no such fixture row')
    return discoveryDb.read(row.propertyId)
  }

  /** The stored next-due time of a seeded row (the first by default). */
  const nextDueOf = async (deps: { rows: DiscoveryPropertyFixture[] }, index = 0) =>
    (await stored(deps.rows[index])).nextDueAt

  async function makeDeps(rows: DiscoveryPropertyFixture[], opts: SweepOptions = {}) {
    await discoveryDb.seed(rows)
    const discoveryRepo = discoveryDb.repo()
    const findSpy = vi.spyOn(discoveryRepo, 'findDuePropertiesBatch')
    const enqueued: SyncPropertyReviewsJobData[] = []
    const enqueuedOptions: (AddSyncJobOptions | undefined)[] = []
    const queue: ReviewQueuePort = {
      addSyncJob: async (data, options) => {
        if (opts.failEnqueue) throw new Error('Redis down')
        enqueued.push(data)
        enqueuedOptions.push(options)
      },
    }
    const logger = { info: vi.fn(), warn: vi.fn() }
    const handler = createDiscoverNewReviewsHandler({
      discoveryRepo,
      queue,
      clock: opts.clock ?? (() => NOW),
      logger,
      batchSize: opts.batchSize ?? 2,
      maxBatches: opts.maxBatches ?? 10,
      ...(opts.intervalMs === undefined ? {} : { intervalMs: opts.intervalMs }),
      ...(opts.spreadWindowMs === undefined
        ? {}
        : { spreadWindowMs: opts.spreadWindowMs }),
      skipRecentlyReconciled: opts.skipRecentlyReconciled ?? true,
    })
    return { handler, discoveryRepo, enqueued, enqueuedOptions, findSpy, rows, logger }
  }

  async function makeHeadDeps(
    rows: DiscoveryPropertyFixture[],
    opts: HeadSweepOptions = {},
  ) {
    await discoveryDb.seed(rows)
    const discoveryRepo = discoveryDb.repo()
    const syncJobs: SyncPropertyReviewsJobData[] = []
    const headCalls: HeadCall[] = []
    const headQueue: ReviewHeadCheckQueuePort = {
      addHeadCheckJob: async (data, options) => {
        if (opts.failHeadEnqueue) throw new Error('Redis down')
        headCalls.push({ data, options })
      },
    }
    const logger = { info: vi.fn(), warn: vi.fn() }
    const handler = createDiscoverNewReviewsHandler({
      discoveryRepo,
      queue: { addSyncJob: async (data) => void syncJobs.push(data) },
      clock: opts.clock ?? (() => NOW),
      logger,
      batchSize: opts.batchSize ?? 10,
      spreadWindowMs: opts.spreadWindowMs ?? 0,
      skipRecentlyReconciled: opts.skipRecentlyReconciled ?? true,
      ...(opts.headChecks === undefined ? {} : { headChecks: opts.headChecks }),
      ...(opts.reconcileWithinMs === undefined
        ? {}
        : { reconcileWithinMs: opts.reconcileWithinMs }),
      ...(opts.withQueue === false ? {} : { headCheckQueue: headQueue }),
    })
    return { handler, discoveryRepo, rows, syncJobs, headCalls, logger }
  }

  return { stored, nextDueOf, makeDeps, makeHeadDeps }
}
