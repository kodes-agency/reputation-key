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
import { EXECUTION_POLICY_VERSION } from '#/shared/auth/execution-policy'
import { DATA_CELL_CATALOGUE_POLICY_VERSION } from '#/shared/domain/data-cell-catalogue'

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
  routingPolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
}

const stubStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
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
    publicationActorAuthority: async () => true,
    replyBrandProfiles: {
      isCurrentAiReplyBrandProfile: async () => true,
    },
    db: (over.db ?? dbReturningProperty(null)) as never,
    events: createCapturingEventBus(),
    outboxRepo: { insertReceipt: vi.fn() } as never,
    clock: () => new Date('2026-07-18T00:00:00Z'),
    idGen: () => 'review-build-id',
    snapshotRunIdGen: () => 'review-build-snapshot-run-id',
    googleReviewApi: {} as never,
    jobQueue,
    workerRuntime: {
      pool: {} as never,
      registry: { register: vi.fn() },
      backgroundQueue: undefined,
    },
    logger: createMockLogger(),
    staffPublicApi: stubStaffApi,
    propertyApi: {
      getProcessingScope: async () => ({ processingRegion: 'us', sourceEpoch: 0 }),
    },
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

const SYNC_EXECUTION = {
  capability: 'property.connect_gbp',
  initiator: { kind: 'system', id: 'queue:review-sync' },
  policyVersionAtEnqueue: EXECUTION_POLICY_VERSION,
} as const

describe('sync enqueue routing stamp (BQC-4.2)', () => {
  it('exposes the Review-owned source-content lifecycle authority', () => {
    const { api } = setup()

    expect(api.maintenance.runSourceContentLifecycle).toEqual(expect.any(Function))
    expect(api.maintenance.publicationReconciliation).toEqual({
      findCandidates: expect.any(Function),
      reconcile: expect.any(Function),
    })
    expect(api.maintenance.recovery.createAuthority({})).toMatchObject({
      kind: 'inspection_only',
      reason: 'reviewed_cutover_authority_required',
    })
  })

  it('exposes the Organization Export contribution outside the request public API', () => {
    const { api } = setup()

    expect(api.organizationExport.contributor.context).toBe('review')
    expect(Object.isFrozen(api.organizationExport)).toBe(true)
    // LIF-01: adding the contributor must not widen the request surface.
    expect(Object.keys(api.publicApi)).not.toContain('organizationExport')
  })

  it('exposes the Organization lifecycle contribution outside the request public API', () => {
    const { api } = setup()

    expect(Object.keys(api.organizationLifecycle)).toEqual(['contributor'])
    expect(api.organizationLifecycle.contributor.context).toBe('review')
    expect(Object.isFrozen(api.organizationLifecycle)).toBe(true)
    // LIF-01: the purge path must stay unreachable from any request surface.
    expect(Object.keys(api.publicApi)).not.toContain('organizationLifecycle')
  })

  it('stamps the content-free routing envelope on a target decision', async () => {
    const resolve = vi.fn(async (): Promise<RoutingDecision> => US_TARGET)
    const { api, jobQueue } = setup({ router: { resolve } })

    await api.publicApi.syncAdmission.addSyncJob(SYNC_DATA)

    expect(resolve).toHaveBeenCalledWith(
      { kind: 'property', propertyId: 'prop-1' },
      'review.sync',
    )
    const [, data] = jobQueue.add.mock.calls[0]!
    expect(data).toEqual({
      ...SYNC_DATA,
      ...SYNC_EXECUTION,
      routing: {
        subject: { kind: 'property', propertyId: 'prop-1' },
        cell: 'us',
        region: 'us',
        workloadClass: 'review.sync',
        routingPolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
      } satisfies RoutingEnvelope,
    })
  })

  it('enqueues an identifier-only targeted fetch through the same governed review-sync job', async () => {
    const resolve = vi.fn(async (): Promise<RoutingDecision> => US_TARGET)
    const { api, jobQueue } = setup({ router: { resolve } })
    const data = {
      mode: 'targeted' as const,
      propertyId: 'prop-1',
      organizationId: 'org-1',
      connectionId: 'conn-1',
      sourceEpoch: 3,
      referenceRef: `v1.${Buffer.alloc(32, 5).toString('base64url')}`,
      deliveryId: '00000000-0000-4000-8000-000000000099',
      initiator: { kind: 'system' as const, id: 'webhook:gbp' },
      correlationId: 'push-event',
    }

    await api.publicApi.syncAdmission.addTargetedFetchJob(data, {
      jobId: 'gbp-push-00000000-0000-4000-8000-000000000099',
    })

    const [name, payload, options] = jobQueue.add.mock.calls[0]!
    expect(name).toBe('sync-property-reviews')
    expect(payload).toMatchObject({
      ...data,
      capability: 'property.connect_gbp',
      routing: { workloadClass: 'review.sync' },
    })
    expect(options).toMatchObject({
      jobId: 'gbp-push-00000000-0000-4000-8000-000000000099',
    })
    expect(JSON.stringify(payload)).not.toContain('accounts/')
  })

  it('enqueues WITHOUT the routing field when the decision is blocked (dispatch is the authority)', async () => {
    const resolve = vi.fn(async (): Promise<RoutingDecision> => ({
      kind: 'blocked',
      reason: 'region_unresolved',
      region: 'unresolved',
    }))
    const { api, jobQueue } = setup({ router: { resolve } })

    await api.internal.repos.queue.addSyncJob(SYNC_DATA)

    const [name, data] = jobQueue.add.mock.calls[0]!
    expect(name).toBe('sync-property-reviews')
    expect(data).toEqual({ ...SYNC_DATA, ...SYNC_EXECUTION })
  })

  it('enqueues WITHOUT the routing field when the routing lookup fails', async () => {
    const resolve = vi.fn(async (): Promise<RoutingDecision> => {
      throw new Error('db down')
    })
    const { api, jobQueue } = setup({ router: { resolve } })

    await api.internal.repos.queue.addSyncJob(SYNC_DATA)

    const [, data] = jobQueue.add.mock.calls[0]!
    expect(data).toEqual({ ...SYNC_DATA, ...SYNC_EXECUTION })
  })

  it('enqueues WITHOUT the routing field when no router is wired', async () => {
    const { api, jobQueue } = setup()

    await api.internal.repos.queue.addSyncJob(SYNC_DATA)

    const [, data] = jobQueue.add.mock.calls[0]!
    expect(data).toEqual({ ...SYNC_DATA, ...SYNC_EXECUTION })
  })

  // The last link of the backoff chain: a rate-limited continuation asks for a
  // delay, and BullMQ only honours it as the `delay` option. Passing it in the
  // job DATA instead would look correct and change nothing about scheduling.
  it('passes a continuation delay to BullMQ as the delay option, not as job data', async () => {
    const { api, jobQueue } = setup()

    await api.internal.repos.queue.addSyncJob(SYNC_DATA, { delayMs: 5_000 })

    const [, data, options] = jobQueue.add.mock.calls[0]!
    expect(options).toMatchObject({ delay: 5_000 })
    expect(data).toEqual({ ...SYNC_DATA, ...SYNC_EXECUTION })
  })

  it('omits delay entirely for an ordinary enqueue', async () => {
    const { api, jobQueue } = setup()

    await api.internal.repos.queue.addSyncJob(SYNC_DATA)

    const [, , options] = jobQueue.add.mock.calls[0]!
    expect(options).not.toHaveProperty('delay')
  })
})

describe('publish enqueue routing stamp (BQC-4.2)', () => {
  const PUBLISH_DATA = { replyId: 'reply-1', organizationId: 'org-1' }
  const PUBLISH_EXECUTION = {
    capability: 'property.publish_reply',
    initiator: { kind: 'system', id: 'queue:reply-publish' },
    policyVersionAtEnqueue: EXECUTION_POLICY_VERSION,
  } as const

  it('resolves reply → property and stamps the routing envelope', async () => {
    const resolve = vi.fn(async (): Promise<RoutingDecision> => US_TARGET)
    const { api, jobQueue } = setup({
      router: { resolve },
      db: dbReturningProperty('prop-9'),
    })

    await api.internal.repos.replyQueue.addPublishJob(PUBLISH_DATA)

    expect(resolve).toHaveBeenCalledWith(
      { kind: 'property', propertyId: 'prop-9' },
      'reply.publish',
    )
    const [name, data] = jobQueue.add.mock.calls[0]!
    expect(name).toBe('publish-reply')
    expect(data).toEqual({
      ...PUBLISH_DATA,
      ...PUBLISH_EXECUTION,
      propertyId: 'prop-9',
      routing: {
        subject: { kind: 'property', propertyId: 'prop-9' },
        cell: 'us',
        region: 'us',
        workloadClass: 'reply.publish',
        routingPolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
      } satisfies RoutingEnvelope,
    })
  })

  it('enqueues WITHOUT the routing field when the reply scope lookup fails', async () => {
    const resolve = vi.fn(async (): Promise<RoutingDecision> => US_TARGET)
    const { api, jobQueue } = setup({ router: { resolve }, db: dbFailing })

    await api.internal.repos.replyQueue.addPublishJob(PUBLISH_DATA)

    const [, data] = jobQueue.add.mock.calls[0]!
    expect(data).toEqual({ ...PUBLISH_DATA, ...PUBLISH_EXECUTION })
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
    expect(data).toEqual({ ...PUBLISH_DATA, ...PUBLISH_EXECUTION })
    expect(resolve).not.toHaveBeenCalled()
  })
})
