import { replyScopeEffects } from '#/contexts/reputation/public-api'
// Review context build wiring and queue-admission tests.

import { describe, expect, it, vi } from 'vitest'
import type { Queue } from 'bullmq'
import { buildReviewContext, wireReviewSourceContentLifecycle } from './build-review'
import { REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION } from './content/run-source-content-lifecycle.server'
import { createConsumerRegistry } from '#/shared/outbox'
import { createMockLogger } from '#/shared/testing/mock-logger'
import type { StaffPublicApi } from '#/contexts/identity/public-api'
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
    replyEffects: replyScopeEffects,
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
    googleConnectionStatus: { findStatus: async () => null },
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
      getPublicationScope: async () => ({ lifecycleState: 'active', sourceEpoch: 0 }),
      getGoogleReadScope: async () => ({
        lifecycleState: 'active',
        googleBindingState: 'unbound',
        googleConnectionId: null,
        sourceEpoch: 0,
      }),
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

it('ships operator and application maintenance wiring without expiry apply authority', async () => {
  const { api } = setup()
  const operatorRun = wireReviewSourceContentLifecycle({
    replyEffects: replyScopeEffects,
    db: {} as never,
    clock: () => new Date('2026-07-18T00:00:00Z'),
  })
  for (const run of [operatorRun, api.maintenance.runSourceContentLifecycle]) {
    await expect(
      run({
        mode: 'apply',
        batchSize: 100,
        applyConfirmation: REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
      }),
    ).rejects.toMatchObject({ code: 'review_destructive_lifecycle_quarantined' })
  }
})

const SYNC_EXECUTION = {
  capability: 'property.connect_gbp',
  initiator: { kind: 'system', id: 'queue:review-sync' },
  policyVersionAtEnqueue: EXECUTION_POLICY_VERSION,
} as const

describe('Review context build', () => {
  it('exposes only the reply request commands, bound to their one implementation', () => {
    const { api } = setup()
    expect(Object.keys(api.publicApi.reply).sort()).toEqual([
      'approve',
      'checkDraft',
      'checkPublication',
      'delete',
      'draft',
      'editPublished',
      'getLibrary',
      'listTemplates',
      'loadTemplate',
      'reject',
      'resetTemplate',
      'retryPublish',
      'saveTemplate',
      'saveVoice',
      'setTemplateHidden',
      'submit',
    ])
    expect(Object.isFrozen(api.publicApi.reply)).toBe(true)
  })

  it('keeps publication and lifecycle consumers registered on every container', () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { api } = setup()
      const registry = createConsumerRegistry()
      api.worker.registerOutboxConsumers(registry)
      expect(
        registry.list().map(({ eventType, consumerName }) => [eventType, consumerName]),
      ).toEqual([
        ['review.reply.publication_requested', 'review.on-reply-publication-requested'],
        [
          'integration.google_account.disconnected',
          'review.on-google-account-disconnected',
        ],
        ['property.archived', 'review.on-property-archived'],
      ])
    }
  })

  it('exposes the Review-owned source-content lifecycle authority', () => {
    const { api } = setup()

    expect(api.maintenance.runSourceContentLifecycle).toEqual(expect.any(Function))
    expect(api.maintenance.publicationReconciliation).toEqual({
      findCandidates: expect.any(Function),
      reconcile: expect.any(Function),
    })
    expect(api.maintenance.restatedRevisions).toEqual({ list: expect.any(Function) })
    expect(api.maintenance.recovery.createAuthority({})).toMatchObject({
      kind: 'inspection_only',
      reason: 'environment_confirmation_required',
    })
  })

  it('builds no Organization export or lifecycle contributor of its own', () => {
    // Export and erasure run through the rights request executors, never from
    // this build.
    const { api } = setup()

    expect(Object.keys(api)).not.toContain('organizationExport')
    expect(Object.keys(api)).not.toContain('organizationLifecycle')
    expect(Object.keys(api.publicApi)).not.toContain('organizationExport')
    expect(Object.keys(api.publicApi)).not.toContain('organizationLifecycle')
  })

  it('publishes only named reads through lookups, never a repository write', () => {
    const { api } = setup()

    expect(Object.keys(api.lookups.reply).sort()).toEqual([
      'findByReviewId',
      'findCurrentGoogleReplyHeadsByReviewIds',
      'findMilestonesByReviewIds',
      'findReviewIdsByReplyStage',
      'findStatesByReviewIds',
    ])
    expect(Object.keys(api.lookups.review).sort()).toEqual([
      'findById',
      'findByIds',
      'findByOrganizationId',
      'findByPropertyId',
    ])
    expect(Object.keys(api.lookups.googleRatingReads).sort()).toEqual([
      'getDailyCounts',
      'getLowReviews',
      'getMonthlyTotals',
      'getRatingSummary',
      'getShownNumberChanges',
      'getStarDistribution',
      'getWeeklyHistory',
      'getYearlyTotals',
    ])
    expect(Object.isFrozen(api.lookups.reply)).toBe(true)
    expect(Object.isFrozen(api.lookups.review)).toBe(true)
    expect(Object.isFrozen(api.lookups.googleRatingReads)).toBe(true)
    // A spread is what once carried the reply writes across to Inbox.
    expect({ ...api.lookups.reply }).not.toHaveProperty('upsert')
    expect({ ...api.lookups.reply }).not.toHaveProperty('saveDraft')
    expect({ ...api.lookups.reply }).not.toHaveProperty('deleteDraft')
    expect({ ...api.lookups.review }).not.toHaveProperty('upsert')
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
})
