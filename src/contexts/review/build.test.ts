// Review context — BQC-4.2 routing-envelope stamping tests (build.ts).
//
// The enqueue adapters stamp a content-free RoutingEnvelope (propertyId,
// region, workload class, routing-policy version) resolved through the
// ProcessingRouter. The stamp is TELEMETRY: the worker re-resolves routing at
// dispatch and that fresh decision is the authority (a payload region is
// never accepted on its own). Stamping is therefore best-effort — a blocked
// decision, a lookup failure, or a missing router degrades to an UNSTAMPED
// envelope; the job is still enqueued and the dispatch gate decides.

import { describe, it, expect, vi } from 'vitest'
import type { Queue } from 'bullmq'
import { buildReviewContext } from './build'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createMockLogger } from '#/shared/testing/mock-logger'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type {
  ProcessingRouter,
  RoutingDecision,
  RoutingEnvelope,
} from '#/shared/routing/processing-router'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => createMockLogger(),
}))

vi.mock('#/shared/observability/trace', () => ({
  trace: async (_name: string, fn: () => Promise<unknown>) => fn(),
}))

const US_TARGET: RoutingDecision = {
  kind: 'target',
  cell: 'us',
  region: 'us',
  queue: 'default',
  provider: 'gbp-default',
  routingPolicyVersion: 2,
}

const stubStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
}

/** Drizzle select chain for the publish-reply scope resolver (reply → property). */
function dbReturningProperty(propertyId: string | null) {
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => (propertyId ? [{ propertyId }] : []),
          }),
        }),
      }),
    }),
  }
}

const dbFailing = {
  select: () => ({
    from: () => ({
      innerJoin: () => ({
        where: () => ({
          limit: async () => {
            throw new Error('db down')
          },
        }),
      }),
    }),
  }),
}

function setup(
  over: {
    router?: ProcessingRouter
    db?: unknown
  } = {},
) {
  const jobQueue = {
    add: vi.fn(async () => ({})),
  } as unknown as Queue & { add: ReturnType<typeof vi.fn> }
  const api = buildReviewContext({
    db: (over.db ?? dbReturningProperty(null)) as never,
    events: createCapturingEventBus(),
    clock: () => new Date('2026-07-18T00:00:00Z'),
    googleReviewApi: {} as never,
    jobQueue,
    logger: createMockLogger(),
    staffPublicApi: stubStaffApi,
    propertyRoutingLookup: { getProcessingRegion: async () => 'us' },
    ...(over.router ? { processingRouter: over.router } : {}),
  })
  return { api, jobQueue }
}

const SYNC_DATA = {
  propertyId: 'prop-1',
  organizationId: 'org-1',
  connectionId: 'conn-1',
  locationName: 'locations/1',
}

describe('sync enqueue routing stamp (BQC-4.2)', () => {
  it('stamps the content-free routing envelope on a target decision', async () => {
    const resolve = vi.fn(async (): Promise<RoutingDecision> => US_TARGET)
    const { api, jobQueue } = setup({ router: { resolve } })

    await api.internal.repos.queue.addSyncJob(SYNC_DATA)

    expect(resolve).toHaveBeenCalledWith('prop-1', 'review.sync')
    const [, data] = jobQueue.add.mock.calls[0]!
    expect(data).toEqual({
      ...SYNC_DATA,
      routing: {
        propertyId: 'prop-1',
        region: 'us',
        workloadClass: 'review.sync',
        routingPolicyVersion: 2,
      } satisfies RoutingEnvelope,
    })
  })

  it('enqueues WITHOUT the routing field when the decision is blocked (dispatch is the authority)', async () => {
    const resolve = vi.fn(
      async (): Promise<RoutingDecision> => ({
        kind: 'blocked',
        reason: 'region_unresolved',
        region: 'unresolved',
      }),
    )
    const { api, jobQueue } = setup({ router: { resolve } })

    await api.internal.repos.queue.addSyncJob(SYNC_DATA)

    const [name, data] = jobQueue.add.mock.calls[0]!
    expect(name).toBe('sync-property-reviews')
    expect(data).toEqual(SYNC_DATA)
  })

  it('enqueues WITHOUT the routing field when the routing lookup fails', async () => {
    const resolve = vi.fn(async (): Promise<RoutingDecision> => {
      throw new Error('db down')
    })
    const { api, jobQueue } = setup({ router: { resolve } })

    await api.internal.repos.queue.addSyncJob(SYNC_DATA)

    const [, data] = jobQueue.add.mock.calls[0]!
    expect(data).toEqual(SYNC_DATA)
  })

  it('enqueues WITHOUT the routing field when no router is wired', async () => {
    const { api, jobQueue } = setup()

    await api.internal.repos.queue.addSyncJob(SYNC_DATA)

    const [, data] = jobQueue.add.mock.calls[0]!
    expect(data).toEqual(SYNC_DATA)
  })
})

describe('publish enqueue routing stamp (BQC-4.2)', () => {
  const PUBLISH_DATA = { replyId: 'reply-1', organizationId: 'org-1' }

  it('resolves reply → property and stamps the routing envelope', async () => {
    const resolve = vi.fn(async (): Promise<RoutingDecision> => US_TARGET)
    const { api, jobQueue } = setup({
      router: { resolve },
      db: dbReturningProperty('prop-9'),
    })

    await api.internal.repos.replyQueue.addPublishJob(PUBLISH_DATA)

    expect(resolve).toHaveBeenCalledWith('prop-9', 'reply.publish')
    const [name, data] = jobQueue.add.mock.calls[0]!
    expect(name).toBe('publish-reply')
    expect(data).toEqual({
      ...PUBLISH_DATA,
      routing: {
        propertyId: 'prop-9',
        region: 'us',
        workloadClass: 'reply.publish',
        routingPolicyVersion: 2,
      } satisfies RoutingEnvelope,
    })
  })

  it('enqueues WITHOUT the routing field when the reply scope lookup fails', async () => {
    const resolve = vi.fn(async (): Promise<RoutingDecision> => US_TARGET)
    const { api, jobQueue } = setup({ router: { resolve }, db: dbFailing })

    await api.internal.repos.replyQueue.addPublishJob(PUBLISH_DATA)

    const [, data] = jobQueue.add.mock.calls[0]!
    expect(data).toEqual(PUBLISH_DATA)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('enqueues WITHOUT the routing field when the reply has no resolvable property', async () => {
    const resolve = vi.fn(async (): Promise<RoutingDecision> => US_TARGET)
    const { api, jobQueue } = setup({
      router: { resolve },
      db: dbReturningProperty(null),
    })

    await api.internal.repos.replyQueue.addPublishJob(PUBLISH_DATA)

    const [, data] = jobQueue.add.mock.calls[0]!
    expect(data).toEqual(PUBLISH_DATA)
    expect(resolve).not.toHaveBeenCalled()
  })
})
