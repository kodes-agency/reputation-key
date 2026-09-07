// Review context build wiring and queue-admission tests.

import { describe, expect, it, vi } from 'vitest'
import type { Queue } from 'bullmq'
import { buildReviewContext } from './build'
import { createMockLogger } from '#/shared/testing/mock-logger'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { EXECUTION_POLICY_VERSION } from '#/shared/auth/execution-policy'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => createMockLogger(),
}))

vi.mock('#/shared/observability/trace', () => ({
  trace: async (_name: string, fn: () => Promise<unknown>) => fn(),
}))

const stubStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

function setup() {
  const jobQueue = {
    add: vi.fn(async (_name: string, _data: unknown, _options: unknown) => ({})),
  }
  const api = buildReviewContext({
    publicationActorAuthority: async () => true,
    replyBrandProfiles: {
      isCurrentAiReplyBrandProfile: async () => true,
    },
    db: {} as never,
    outboxRepo: { insertReceipt: vi.fn() } as never,
    clock: () => new Date('2026-07-18T00:00:00Z'),
    idGen: () => 'review-build-id',
    snapshotRunIdGen: () => 'review-build-snapshot-run-id',
    googleReviewApi: {} as never,
    jobQueue: jobQueue as unknown as Queue,
    workerRuntime: {
      pool: {} as never,
      registry: { register: vi.fn() },
      backgroundQueue: undefined,
    },
    logger: createMockLogger(),
    staffPublicApi: stubStaffApi,
    propertyApi: {
      getSourceEpoch: async () => ({ sourceEpoch: 0 }),
    },
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

describe('Review context build', () => {
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
    expect(Object.keys(api.publicApi)).not.toContain('organizationExport')
  })

  it('exposes the Organization lifecycle contribution outside the request public API', () => {
    const { api } = setup()

    expect(Object.keys(api.organizationLifecycle)).toEqual(['contributor'])
    expect(api.organizationLifecycle.contributor.context).toBe('review')
    expect(Object.isFrozen(api.organizationLifecycle)).toBe(true)
    expect(Object.keys(api.publicApi)).not.toContain('organizationLifecycle')
  })
})

describe('Review queue admission', () => {
  it('enqueues sync work with its execution authority', async () => {
    const { api, jobQueue } = setup()

    await api.publicApi.syncAdmission.addSyncJob(SYNC_DATA)

    expect(jobQueue.add).toHaveBeenCalledWith(
      'sync-property-reviews',
      { ...SYNC_DATA, ...SYNC_EXECUTION },
      expect.objectContaining({ removeOnComplete: { count: 100 } }),
    )
  })

  it('enqueues an identifier-only targeted fetch through the governed review-sync job', async () => {
    const { api, jobQueue } = setup()
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
    expect(payload).toEqual({
      ...data,
      capability: 'property.connect_gbp',
      policyVersionAtEnqueue: EXECUTION_POLICY_VERSION,
    })
    expect(options).toMatchObject({
      jobId: 'gbp-push-00000000-0000-4000-8000-000000000099',
    })
    expect(JSON.stringify(payload)).not.toContain('accounts/')
  })

  // The last link of the backoff chain: a rate-limited continuation asks for a
  // delay, and BullMQ only honours it as the `delay` option.
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

  it('enqueues reply publication with the supplied Property scope', async () => {
    const { api, jobQueue } = setup()
    const data = {
      replyId: 'reply-1',
      organizationId: 'org-1',
      propertyId: 'prop-9',
    }

    await api.internal.repos.replyQueue.addPublishJob(data)

    expect(jobQueue.add).toHaveBeenCalledWith(
      'publish-reply',
      {
        ...data,
        capability: 'property.publish_reply',
        initiator: { kind: 'system', id: 'queue:reply-publish' },
        policyVersionAtEnqueue: EXECUTION_POLICY_VERSION,
      },
      expect.objectContaining({ removeOnComplete: { count: 100 } }),
    )
  })
})
