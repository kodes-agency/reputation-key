import { RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'
import { executeRetentionRule } from '#/shared/db/retention/execute-retention-rule'
import { durableConsumersFor } from '#/shared/governance/event-job-catalogue'
import { createGoogleImportV2Processor } from '../application/google-import-v2-processor'
import { createGoogleImportV2ClaimReaper } from '../application/google-import-v2-claim-reaper'
import type { Job } from 'bullmq'
import { properties } from '#/shared/db/schema/property.schema'
import { portalPageEdits } from '#/shared/db/schema/portal-publication.schema'
import {
  propertyPortalBrandContents,
  propertyPortalBrandProfiles,
} from '#/shared/db/schema/portal.schema'
import { buildGoogleImportedProperty } from '#/contexts/property/application/public-api'
import { googleConnectionId } from '#/shared/domain/ids'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { buildConsumerEvent, type ConsumerEvent } from '#/shared/outbox/envelope'
import { createOutboxRelay } from '#/shared/outbox/relay'
import { reconcileWorkItems } from '#/shared/jobs/work-items.server'
import { workItems } from '#/shared/db/schema/work-items.schema'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { createPortalExperienceRepository } from '#/contexts/portal/infrastructure/repositories/portal-experience.repository'
import { ensureDefaultPublicDisplayName } from '#/contexts/portal/application/use-cases/manage-portal-experience'
import { admitReviewSync } from '#/contexts/review/application/use-cases/admit-review-sync'
import { createReviewDiscoveryRepository } from '#/contexts/review/infrastructure/repositories/review-discovery.repository'
import type { GoogleReviewApiPort } from '#/contexts/review/application/ports/google-review-api.port'
import { reviewProviderSnapshotRuns } from '#/shared/db/schema/review.schema'
import { createReviewProviderSnapshotRepository } from '#/contexts/review/infrastructure/repositories/review-provider-snapshot.repository'
import { runReviewProviderSnapshot } from '#/contexts/review/application/use-cases/run-review-provider-snapshot'
import { createSyncPropertyReviewsHandler } from '#/contexts/review/infrastructure/jobs/sync-property-reviews.job'
import {
  acceptGoogleImportSync,
  admitGoogleImportSync,
} from '#/contexts/review/infrastructure/google-import-sync-acceptance'
import type { SyncPropertyReviewsJobData } from '#/contexts/review/application/ports/review-queue.port'
import {
  createGoogleBindingFollowUpHandlers,
  IMPORT_DISPLAY_NAME_CONSUMER,
  IMPORT_SUBSCRIPTION_CONSUMER,
  IMPORT_REVIEW_SYNC_CONSUMER,
} from './google-binding-follow-up-consumers'
import { completeGoogleImportsForRestore } from './google-import-completion'
import { fixHistoryCutoff } from '#/contexts/review/infrastructure/repositories/review-provider-snapshot.repository'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { createPropertyGoogleBindingStore } from '#/contexts/property/infrastructure/property-google-binding-store'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { createDatabase, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { googleConnections } from '#/shared/db/schema/google-connection.schema'
import {
  gbpImportRequestItems,
  gbpImportRequests,
} from '#/shared/db/schema/google-import-v2.schema'
import { idempotencyReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type { GoogleImportV2Intent } from '../application/ports/google-import-v2-store.port'
import { createGoogleImportV2Lifecycle } from '../application/google-import-v2-lifecycle'
import { createGoogleImportV2Store } from './google-import-v2-store'

const NOW = new Date('2026-10-20T10:00:00.000Z')
const ORG_A = 'google-import-completion-a'
const ORG_B = 'google-import-completion-b'
const USER_ID = 'google-import-completion-user'
const CONNECTION_A = randomUUID()
const CONNECTION_B = randomUUID()
const ORGS = [ORG_A, ORG_B]
const minuteAfter = (at: Date) => new Date(at.getTime() + 60_000)

function intent(organizationId = ORG_A, count = 1, now = NOW): GoogleImportV2Intent {
  const requestId = randomUUID()
  const connectionId = organizationId === ORG_A ? CONNECTION_A : CONNECTION_B
  return {
    id: requestId,
    requestId,
    organizationId,
    initiatedBy: USER_ID,
    wireReplay: { keyVersion: 'v1', digest: 'A'.repeat(43) },
    semanticReplay: { keyVersion: 'v1', digest: 'B'.repeat(43) },
    items: Array.from({ length: count }, () => ({
      id: randomUUID(),
      connectionId,
      existingPropertyId: null,
      destinationPropertyId: randomUUID(),
      providerAccountSuffix: 'account',
      providerLocationSuffix: randomUUID(),
      expectedConnectionLifecycleVersion: 1,
      expectedConnectionAccessVersion: 1,
      expectedCredentialGeneration: 1,
      authorization: {
        organizationId,
        userId: USER_ID,
        connectionId,
        connectionLifecycleVersion: 1,
        connectionAccessVersion: 1,
        credentialGeneration: 1,
        authorizationVector: {
          executionPolicyVersion: 'beta-local-2',
          role: 'Admin',
          permissionDigest: 'a'.repeat(64),
          principalKind: 'user',
          permissionVersion: 1,
          connectionLifecycleVersion: 1,
          connectionAccessVersion: 1,
          credentialGeneration: 1,
        },
      },
      expectedSourceEpoch: null,
      expectedProfileVersion: null,
      action: 'create',
      updateExistingProfile: true,
      propertyName: 'Recovery cafe',
      propertyAddress: null,
      countryCode: 'US',
      timezone: 'UTC',
      effectDeadlineAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
    })),
    now,
    outboxEventId: randomUUID(),
  }
}

describe('Google import completion and follow-up crash recovery (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database
  let store: ReturnType<typeof createGoogleImportV2Store>

  async function clearWork() {
    await db
      .delete(idempotencyReceipts)
      .where(
        sql`${idempotencyReceipts.payload}->>'organizationId' IN (${ORG_A}, ${ORG_B})`,
      )
    await db
      .delete(gbpImportRequests)
      .where(inArray(gbpImportRequests.organizationId, ORGS))
    await db
      .delete(propertyPortalBrandContents)
      .where(inArray(propertyPortalBrandContents.organizationId, ORGS))
    await db
      .delete(propertyPortalBrandProfiles)
      .where(inArray(propertyPortalBrandProfiles.organizationId, ORGS))
    await db.delete(portalPageEdits).where(inArray(portalPageEdits.organizationId, ORGS))
    await db.delete(properties).where(inArray(properties.organizationId, ORGS))
    await db.delete(workItems).where(inArray(workItems.organizationId, ORGS))
    await db.delete(outboxEvents).where(inArray(outboxEvents.organizationId, ORGS))
  }

  async function commit(organizationId = ORG_A, count = 1, now = NOW) {
    const work = intent(organizationId, count, now)
    await expect(store.commitIntent(work)).resolves.toBe('committed')
    return work
  }

  async function readItem(itemId: string) {
    const [item] = await db
      .select()
      .from(gbpImportRequestItems)
      .where(eq(gbpImportRequestItems.id, itemId))
    if (!item) throw new Error('missing recovery fixture')
    return item
  }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 6)
    db = createDatabase(lease.pool)
    store = createGoogleImportV2Store(db, () => NOW, {
      ensureImportFollowUps: createPropertyGoogleBindingStore(db).ensureImportFollowUps,
      readReceipt: createPropertyGoogleBindingStore(db).readReceipt,
      prepareImportSync: (tx, scope) =>
        fixHistoryCutoff(tx, {
          ...scope,
          organizationId: organizationId(scope.organizationId),
          propertyId: propertyId(scope.propertyId),
        }),
    })
    registerAllEventSchemas()
    await clearWork()
    await db
      .delete(googleConnections)
      .where(inArray(googleConnections.organizationId, ORGS))
    await deleteTestOrganizations(db, ORGS)
    for (const organizationId of ORGS) {
      await db.execute(sql`
        INSERT INTO organization (id, name, slug, "createdAt")
        VALUES (${organizationId}, 'Google import recovery', ${organizationId}, ${NOW})
      `)
      await db.insert(googleConnections).values({
        id: organizationId === ORG_A ? CONNECTION_A : CONNECTION_B,
        organizationId,
        googleSubject: organizationId,
        encryptedAccessToken: 'test-access',
        encryptedRefreshToken: 'test-refresh',
        tokenExpiresAt: new Date(NOW.getTime() + 86_400_000),
        scopes: ['https://www.googleapis.com/auth/business.manage'],
        connectedBy: USER_ID,
        createdAt: NOW,
        updatedAt: NOW,
      })
    }
  })

  beforeEach(clearWork)

  afterAll(async () => {
    try {
      if (db) {
        await clearWork()
        await db
          .delete(googleConnections)
          .where(inArray(googleConnections.organizationId, ORGS))
        await deleteTestOrganizations(db, ORGS)
      }
    } finally {
      await lease?.release()
    }
  })

  const propertyApi = () => createPropertyGoogleBindingStore(db)
  const snapshots = () => createReviewProviderSnapshotRepository(db, randomUUID)
  const sourceEpoch = {
    getSourceEpoch: async (
      org: ReturnType<typeof organizationId>,
      id: ReturnType<typeof propertyId>,
    ) => {
      const binding = await propertyApi().readInternal(org, id)
      return binding ? { sourceEpoch: binding.sourceEpoch } : null
    },
  }
  async function createProperty(work: GoogleImportV2Intent) {
    const item = work.items[0]!
    return propertyApi().createBoundProperty({
      organizationId: organizationId(work.organizationId),
      idempotencyKey: item.id,
      property: buildGoogleImportedProperty({
        organizationId: organizationId(work.organizationId),
        propertyId: propertyId(item.destinationPropertyId),
        importItemId: item.id,
        connectionId: googleConnectionId(item.connectionId),
        accountId: item.providerAccountSuffix,
        locationId: item.providerLocationSuffix,
        name: item.propertyName,
        address: item.propertyAddress,
        timezone: item.timezone,
        countryCode: item.countryCode!,
        confirmedBy: USER_ID,
        now: NOW,
      }),
      now: NOW,
    })
  }
  const lifecycle = (now: Date) =>
    createGoogleImportV2Lifecycle({
      store,
      propertyBindingApi: propertyApi(),
      clock: () => now,
      newEventId: randomUUID,
    })
  async function bindingEvent(work: GoogleImportV2Intent): Promise<ConsumerEvent> {
    const [row] = await db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.organizationId, work.organizationId),
          eq(outboxEvents.propertyId, work.items[0]!.destinationPropertyId),
          eq(outboxEvents.eventType, 'property.google_binding.changed'),
        ),
      )
    if (!row) throw new Error('Property did not commit its binding fact')
    return buildConsumerEvent({ ...row, recordedAt: row.createdAt })
  }
  function followUps(
    fault?: {
      at: 'before-effect' | 'after-effect' | 'before-ack' | 'after-ack'
      consumer: string
    },
    listReviewsPage?: GoogleReviewApiPort['listReviewsPage'],
  ) {
    const receipts = createOutboxRepository(db)
    const desiredSubscriptions = new Set<string>()
    const queue: SyncPropertyReviewsJobData[] = []
    const portalRepo = createPortalExperienceRepository(db)
    const defaultName = ensureDefaultPublicDisplayName({
      experienceRepo: portalRepo,
      idGen: randomUUID,
      clock: () => NOW,
    })
    let armed = true
    const crash = (at: string, consumer: string) => {
      if (armed && fault?.at === at && fault.consumer === consumer) {
        armed = false
        throw new Error('worker died')
      }
    }
    const deps = {
      propertyBindingApi: propertyApi(),
      defaultPublicDisplayName: async (input: Parameters<typeof defaultName>[0]) => {
        crash('before-effect', IMPORT_DISPLAY_NAME_CONSUMER)
        const result = await defaultName(input)
        crash('after-effect', IMPORT_DISPLAY_NAME_CONSUMER)
        return result
      },
      subscribe: async (_org: ReturnType<typeof organizationId>, connection: string) => {
        crash('before-effect', IMPORT_SUBSCRIPTION_CONSUMER)
        desiredSubscriptions.add(connection)
        crash('after-effect', IMPORT_SUBSCRIPTION_CONSUMER)
        return {
          outcome: 'subscribed' as const,
          accounts: { subscribed: 1, alreadySubscribed: 0, failed: 0, failureCodes: {} },
        }
      },
      enqueueReviewSync: admitReviewSync({
        queue: {
          addSyncJob: async (data) => {
            crash('before-effect', IMPORT_REVIEW_SYNC_CONSUMER)
            queue.push(data)
            crash('after-effect', IMPORT_REVIEW_SYNC_CONSUMER)
          },
        },
        propertySourceEpoch: sourceEpoch,
        historyCutoffs: snapshots(),
        admitImportSync: (data) => admitGoogleImportSync(db, randomUUID, data),
      }),
      receipts: {
        hasReceipt: receipts.hasReceipt,
        insertReceipt: async (...args: Parameters<typeof receipts.insertReceipt>) => {
          crash('before-ack', args[1])
          const result = await receipts.insertReceipt(...args)
          crash('after-ack', args[1])
          return result
        },
      },
      newDeliveryId: randomUUID,
    }
    // Execute real snapshot orchestration with an empty provider listing. No
    // observation writer may be needed when Google reports no reviews.
    const runSnapshot = runReviewProviderSnapshot({
      repository: snapshots(),
      propertySourceEpoch: sourceEpoch,
      googleReviewApi: {
        listReviewsPage:
          listReviewsPage ??
          (async () => ({
            reviews: [],
            totalReviewCount: 0,
            averageRating: null,
            nextCursorRef: null,
          })),
        readReviewsHead: vi.fn(),
        getReview: vi.fn(),
        discardReviewCursors: vi.fn(),
        replyToReview: vi.fn(),
      },
      observationWriter: {
        persist: async () => {
          throw new Error('empty listing produced a review')
        },
        allocateReplyReadGeneration: vi.fn(),
      },
      subjectKeyService: {
        acquireDeriver: async () => ({
          activeVersion: 'v1',
          retiringVersion: null,
          inventoryGeneration: 1,
          deriveCandidates: () => {
            throw new Error('empty listing requested a provider subject')
          },
        }),
        stageTrustedNext: vi.fn(),
        activateTrustedNext: vi.fn(),
        removeRetiring: vi.fn(),
      },
      syncActivity: { recordNewReviewObserved: vi.fn(), recordPushObserved: vi.fn() },
      clock: () => NOW,
      logger: createMockLogger(),
    })
    const discoveryRepo = createReviewDiscoveryRepository(db)
    const worker = createSyncPropertyReviewsHandler({
      runSnapshot,
      propertySourceEpoch: sourceEpoch,
      clock: () => new Date(),
      hotIntervalMs: 60_000,
      enqueueContinuation: async (data) => {
        queue.push(data)
      },
      syncActivity: { recordNewReviewObserved: vi.fn(), recordPushObserved: vi.fn() },
      discoveryRepo,
      acknowledgeImportSync: async (data) => {
        crash('before-ack', IMPORT_REVIEW_SYNC_CONSUMER)
        await acceptGoogleImportSync(db, data)
        crash('after-ack', IMPORT_REVIEW_SYNC_CONSUMER)
      },
    })
    return {
      handlers: createGoogleBindingFollowUpHandlers(deps),
      receipts,
      queue,
      worker,
      portalRepo,
      desiredSubscriptions,
      discoveryRepo,
    }
  }

  it('waits behind the item effect, then adopts the Property commit after the worker dies', async () => {
    const work = await commit()
    const item = work.items[0]!
    const fence = randomUUID()
    await expect(
      store.claimItem({
        organizationId: ORG_A,
        itemId: item.id,
        retryRevision: 0,
        dispatchEpoch: 0,
        attemptOrdinal: 1,
        claimFence: fence,
        now: NOW,
        leaseExpiresAt: minuteAfter(NOW),
      }),
    ).resolves.toMatchObject({ kind: 'claimed' })
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const death = new Error('worker died after Property commit')
    const effect = store.runClaimedEffect(
      {
        organizationId: ORG_A,
        itemId: item.id,
        retryRevision: 0,
        dispatchEpoch: 0,
        attemptOrdinal: 1,
        claimFence: fence,
        now: NOW,
      },
      async () => {
        entered.resolve()
        await release.promise
        await createProperty(work)
        throw death
      },
    )
    const observedDeath = expect(effect).rejects.toBe(death)
    await entered.promise
    const sweep = lifecycle(new Date(item.effectDeadlineAt.getTime() + 1)).sweep()
    try {
      // A database-observed barrier, rather than a timing guess: lifecycle is
      // blocked behind the worker before the Property transaction is committed.
      await vi.waitFor(async () => {
        const blocked = await lease.pool.query(
          "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%gbp_import_request_items%'",
        )
        expect(blocked.rows[0].count).toBeGreaterThan(0)
      })
    } finally {
      release.resolve()
    }
    await observedDeath
    await sweep
    await expect(readItem(item.id)).resolves.toMatchObject({
      status: 'imported',
      outcomeCode: 'imported',
      destinationPropertyId: item.destinationPropertyId,
      nextDispatchAt: null,
    })
    await expect(store.getProgress(ORG_A, USER_ID, work.id)).resolves.toMatchObject({
      status: 'completed',
      processedCount: 1,
      counts: { imported: 1, failed: 0, processing: 0 },
    })
    expect(
      await snapshots().readHistoryCutoff({
        organizationId: organizationId(ORG_A),
        propertyId: propertyId(item.destinationPropertyId),
        sourceEpoch: 0,
      }),
    ).not.toBeNull()
  })

  it('recovers follow-ups after Property commit, queue loss, failed recovery, and lifecycle completion', async () => {
    const work = await commit()
    await createProperty(work)
    const event = await bindingEvent(work)
    const follow = followUps({
      at: 'before-effect',
      consumer: IMPORT_DISPLAY_NAME_CONSUMER,
    })
    const recoveryAt = new Date(work.items[0]!.effectDeadlineAt.getTime() + 1)
    const processor = createGoogleImportV2Processor({
      store,
      propertyBindingApi: {
        ...propertyApi(),
        readReceipt: async () => {
          throw new Error('receipt unavailable')
        },
      },
      authorizeGoogleImportCommand: async () => {
        throw new Error('committed work must not be authorized again')
      },
      resolveActor: async () => {
        throw new Error('committed work must not resolve an actor')
      },
      clock: () => recoveryAt,
      newClaimFence: randomUUID,
      logger: createMockLogger(),
    })
    const recover = createGoogleImportV2ClaimReaper({
      store,
      processItem: processor.process,
      queue: {
        addImportItemJobs: async () => {
          throw new Error('expired work must reconcile')
        },
      },
      clock: () => recoveryAt,
      newDeliveryId: randomUUID,
      logger: createMockLogger(),
    })
    await expect(recover()).resolves.toMatchObject({ itemFailures: 1 })
    await expect(readItem(work.items[0]!.id)).resolves.toMatchObject({
      status: 'pending',
    })

    await expect(follow.handlers.displayName(event)).rejects.toThrow(
      'Google import display name unavailable',
    )
    await lifecycle(new Date(work.items[0]!.effectDeadlineAt.getTime() + 1)).sweep()
    await expect(readItem(work.items[0]!.id)).resolves.toMatchObject({
      status: 'imported',
    })
    await db
      .update(outboxEvents)
      .set({ publishedAt: NOW })
      .where(eq(outboxEvents.id, event.eventId))
    const repo = createOutboxRepository(db, () => minuteAfter(NOW))
    // Publication without a queue leaves pending work for the independent sweep.
    await createOutboxRelay(repo, undefined).poll()
    const redispatches: string[] = []
    await reconcileWorkItems({
      reserveDispatch: (cutoff) => repo.delivery.workItems.reserveDispatch(cutoff),
      enqueue: async (_kind, data) => {
        const work = await repo.delivery.workItems.inspect(ORG_A, data.workId)
        if (work) {
          expect(work).toMatchObject({ state: 'pending', attempts: 0 })
          redispatches.push(work.subjectId)
        }
      },
      clock: () => minuteAfter(NOW),
    })
    expect(redispatches).toContain(event.eventId)
    await follow.handlers.displayName(event)
    await follow.handlers.subscription(event)
    await expect(follow.handlers.reviewSync(event)).rejects.toThrow(
      'awaiting durable acceptance',
    )
    follow.queue.length = 0 // Queue Redis dies after accepting the first sync.
    expect(
      await follow.receipts.hasReceipt(event.eventId, IMPORT_REVIEW_SYNC_CONSUMER),
    ).toBe(false)
    await expect(follow.handlers.reviewSync(event)).rejects.toThrow(
      'awaiting durable acceptance',
    )
    const sync = follow.queue.shift()!
    await follow.worker({ data: sync } as Job<SyncPropertyReviewsJobData>)
    expect(
      await follow.receipts.hasReceipt(event.eventId, IMPORT_REVIEW_SYNC_CONSUMER),
    ).toBe(true)
    await expect(follow.handlers.reviewSync(event)).resolves.toEqual({
      status: 'duplicate',
    })
    await expect(admitGoogleImportSync(db, randomUUID, sync)).resolves.toBeNull()
    expect(follow.desiredSubscriptions.size).toBe(1)
    const profile = await follow.portalRepo.getPropertyExperience(
      organizationId(ORG_A),
      propertyId(work.items[0]!.destinationPropertyId),
    )
    expect(profile).toMatchObject({ profile: { displayName: 'Recovery cafe' } })
  })

  it.each(['cursor_lost', 'listing_changed'] as const)(
    'continues the replacement import run after %s even when the binding fact is acknowledged',
    async (code) => {
      const work = await commit()
      await createProperty(work)
      const event = await bindingEvent(work)
      const follow = followUps()
      await expect(follow.handlers.reviewSync(event)).rejects.toThrow(
        'awaiting durable acceptance',
      )
      const initial = follow.queue.shift()!
      await follow.worker({ data: initial } as Job<SyncPropertyReviewsJobData>)
      expect(
        await follow.receipts.hasReceipt(event.eventId, IMPORT_REVIEW_SYNC_CONSUMER),
      ).toBe(true)
      await snapshots().failRun({
        runId: initial.runId!,
        organizationId: organizationId(ORG_A),
        code,
      })
      await follow.worker({
        data: follow.queue.shift()!,
      } as Job<SyncPropertyReviewsJobData>)
      const replacement = follow.queue.shift()!
      expect(replacement).not.toHaveProperty('runId')
      await follow.worker({ data: replacement } as Job<SyncPropertyReviewsJobData>)
      expect(follow.queue[0]?.runId).toBeDefined()
      expect(follow.queue[0]?.runId).not.toBe(initial.runId)
      while (follow.queue.length)
        await follow.worker({
          data: follow.queue.shift()!,
        } as Job<SyncPropertyReviewsJobData>)
      const runs = await db
        .select({ state: reviewProviderSnapshotRuns.state })
        .from(reviewProviderSnapshotRuns)
        .where(
          eq(reviewProviderSnapshotRuns.propertyId, work.items[0]!.destinationPropertyId),
        )
      expect(runs.map((run) => run.state).sort()).toEqual(['completed', 'failed'])
    },
  )

  it.each(['review_cap_exceeded', 'provider_rejected'] as const)(
    'preserves the initial %s retry deadline across binding redelivery and a lost acknowledgement',
    async (code) => {
      const work = await commit()
      await createProperty(work)
      const event = await bindingEvent(work)
      const listReviewsPage = vi.fn<GoogleReviewApiPort['listReviewsPage']>(async () => {
        if (code === 'provider_rejected')
          throw Object.assign(new Error('synthetic refusal'), {
            _tag: 'GoogleReviewApiError',
            code,
            recoverable: false,
            failure: { executionCode: null, dispatch: 'answered', providerStatus: 404 },
          })
        return {
          reviews: [],
          totalReviewCount: 10_001,
          averageRating: null,
          nextCursorRef: null,
        }
      })
      const follow = followUps(
        { at: 'before-ack', consumer: IMPORT_REVIEW_SYNC_CONSUMER },
        listReviewsPage,
      )
      await expect(follow.handlers.reviewSync(event)).rejects.toThrow(
        'awaiting durable acceptance',
      )
      const initial = follow.queue.shift()!
      await expect(
        follow.worker({ data: initial } as Job<SyncPropertyReviewsJobData>),
      ).rejects.toThrow('worker died')
      const scheduled = await follow.discoveryRepo.findFailureState(initial.propertyId)
      expect(scheduled?.errorClass).toBe(code)
      if (code === 'review_cap_exceeded')
        expect(scheduled?.retryAt).toEqual(
          new Date(scheduled!.failedAt!.getTime() + 86_400_000),
        )
      expect(scheduled?.retryAt!.getTime()).toBeGreaterThan(NOW.getTime())
      await expect(follow.handlers.reviewSync(event)).rejects.toThrow(
        'awaiting durable acceptance',
      )
      const redelivery = follow.queue.shift()!
      expect(redelivery.runId).toBe(initial.runId)
      await follow.worker({ data: redelivery } as Job<SyncPropertyReviewsJobData>)
      await expect(follow.handlers.reviewSync(event)).resolves.toEqual({
        status: 'duplicate',
      })
      expect(follow.queue).toEqual([])
      expect(listReviewsPage).toHaveBeenCalledTimes(1)
      expect(await follow.discoveryRepo.findFailureState(initial.propertyId)).toEqual(
        scheduled,
      )
      const runs = await db
        .select({ state: reviewProviderSnapshotRuns.state })
        .from(reviewProviderSnapshotRuns)
        .where(eq(reviewProviderSnapshotRuns.propertyId, initial.propertyId))
      expect(runs).toEqual([{ state: 'failed' }])
    },
  )

  it.each(
    [
      IMPORT_DISPLAY_NAME_CONSUMER,
      IMPORT_SUBSCRIPTION_CONSUMER,
      IMPORT_REVIEW_SYNC_CONSUMER,
    ].flatMap((consumer) =>
      ['before-effect', 'after-effect', 'before-ack', 'after-ack'].map(
        (at) => ({ consumer, at }) as const,
      ),
    ),
  )(
    'recovers a death $at for $consumer without losing the acknowledgement',
    async ({ consumer, at }) => {
      const work = await commit()
      await createProperty(work)
      const event = await bindingEvent(work)
      const follow = followUps({
        consumer,
        at: at as 'before-effect' | 'after-effect' | 'before-ack' | 'after-ack',
      })
      const handler =
        consumer === IMPORT_DISPLAY_NAME_CONSUMER
          ? follow.handlers.displayName
          : consumer === IMPORT_SUBSCRIPTION_CONSUMER
            ? follow.handlers.subscription
            : follow.handlers.reviewSync
      if (
        consumer === IMPORT_REVIEW_SYNC_CONSUMER &&
        (at === 'before-ack' || at === 'after-ack')
      ) {
        await expect(handler(event)).rejects.toThrow('awaiting durable acceptance')
        await expect(
          follow.worker({
            data: follow.queue.shift()!,
          } as Job<SyncPropertyReviewsJobData>),
        ).rejects.toThrow('worker died')
      } else
        await expect(handler(event)).rejects.toThrow(
          consumer === IMPORT_DISPLAY_NAME_CONSUMER
            ? 'Google import display name unavailable'
            : consumer === IMPORT_SUBSCRIPTION_CONSUMER
              ? 'Google import subscription incomplete'
              : 'Google import sync awaiting durable acceptance',
        )
      expect(await follow.receipts.hasReceipt(event.eventId, consumer)).toBe(
        at === 'after-ack',
      )
      if (consumer === IMPORT_REVIEW_SYNC_CONSUMER && at !== 'after-ack') {
        await expect(handler(event)).rejects.toThrow('awaiting durable acceptance')
        await follow.worker({
          data: follow.queue.shift()!,
        } as Job<SyncPropertyReviewsJobData>)
      } else await handler(event)
      expect(await follow.receipts.hasReceipt(event.eventId, consumer)).toBe(true)
      await expect(handler(event)).resolves.toEqual({ status: 'duplicate' })
      if (consumer === IMPORT_SUBSCRIPTION_CONSUMER)
        expect(follow.desiredSubscriptions.size).toBe(1)
      if (consumer === IMPORT_REVIEW_SYNC_CONSUMER) {
        const runs = await db.execute(
          sql`SELECT count(*)::int AS count FROM review_provider_snapshot_runs WHERE organization_id = ${ORG_A} AND property_id = ${work.items[0]!.destinationPropertyId}`,
        )
        expect(runs.rows[0]).toMatchObject({ count: 1 })
      }
    },
  )

  it('keeps binding obligations recoverable after the ordinary redelivery budget', async () => {
    const work = await commit()
    await createProperty(work)
    const event = await bindingEvent(work)
    await db
      .update(outboxEvents)
      .set({ publishedAt: NOW, consumerRedeliveryAttempts: 3 })
      .where(eq(outboxEvents.id, event.eventId))
    const repo = createOutboxRepository(db)
    const due = await repo.delivery.schedulePending(50)
    const delivery = due.find((row) => row.subjectId === event.eventId)
    expect(delivery).toBeDefined()
    expect(await repo.delivery.workItems.inspect(ORG_A, delivery!.id)).toMatchObject({
      state: 'pending',
      attempts: 0,
    })
  })

  it('uses receipt authority and the historical cutoff during isolated restore completion', async () => {
    const work = await commit()
    await createProperty(work)
    await db.transaction((tx) =>
      completeGoogleImportsForRestore(
        tx,
        {
          readReceipt: propertyApi().readReceipt,
          ensureImportFollowUps: propertyApi().ensureImportFollowUps,
          prepareImportSync: (ownerTx, scope) =>
            fixHistoryCutoff(ownerTx, {
              ...scope,
              organizationId: organizationId(scope.organizationId),
              propertyId: propertyId(scope.propertyId),
            }),
        },
        NOW,
      ),
    )
    await expect(readItem(work.items[0]!.id)).resolves.toMatchObject({
      status: 'imported',
      destinationPropertyId: work.items[0]!.destinationPropertyId,
      connectionId: null,
      existingPropertyId: null,
      providerAccountSuffix: null,
      providerLocationSuffix: null,
      googleReviewUri: null,
      googlePrimaryCategory: null,
      expectedConnectionLifecycleVersion: null,
      expectedConnectionAccessVersion: null,
      expectedCredentialGeneration: null,
      expectedExecutionPolicyVersion: null,
      expectedActorRole: null,
      expectedPermissionDigest: null,
      expectedPrincipalKind: null,
      expectedPermissionVersion: null,
      expectedSourceEpoch: null,
      expectedProfileVersion: null,
      claimFence: null,
      claimLeaseExpiresAt: null,
      nextDispatchAt: null,
    })
    expect(
      await snapshots().readHistoryCutoff({
        organizationId: organizationId(ORG_A),
        propertyId: propertyId(work.items[0]!.destinationPropertyId),
        sourceEpoch: 0,
      }),
    ).not.toBeNull()
  })
  it('retains an overdue binding fact until every durable consumer acknowledges it', async () => {
    const work = await commit()
    await createProperty(work)
    const event = await bindingEvent(work)
    await db
      .update(outboxEvents)
      .set({ publishedAt: NOW })
      .where(eq(outboxEvents.id, event.eventId))
    const original = RETENTION_RULES.find(
      (rule) => rule.subject === 'outbox_events.published',
    )!
    const rule = {
      ...original,
      extraWhere: `(${original.extraWhere}) AND organization_id = '${ORG_A}'`,
    }
    const cutoff = new Date(NOW.getTime() + 31 * 86_400_000)
    await expect(executeRetentionRule(db, rule, { cutoff })).resolves.toMatchObject({
      rowsDeleted: 0,
    })
    const receipts = createOutboxRepository(db)
    for (const { name } of durableConsumersFor(event.eventType))
      await receipts.insertReceipt(event.eventId, name, 'applied')
    await expect(executeRetentionRule(db, rule, { cutoff })).resolves.toMatchObject({
      rowsDeleted: 1,
    })
  })
  it('reduces restored active parent counters even when every item is already terminal', async () => {
    const work = await commit()
    await createProperty(work)
    await store.reconcileFromReceipt({
      organizationId: ORG_A,
      itemId: work.items[0]!.id,
      now: NOW,
    })
    await db
      .update(gbpImportRequests)
      .set({
        status: 'processing',
        processedCount: 0,
        importedCount: 0,
        pendingCount: 1,
        firstTerminalAt: null,
        purgeAt: null,
      })
      .where(eq(gbpImportRequests.id, work.id))
    await db.transaction((tx) =>
      completeGoogleImportsForRestore(
        tx,
        {
          readReceipt: propertyApi().readReceipt,
          ensureImportFollowUps: propertyApi().ensureImportFollowUps,
          prepareImportSync: (ownerTx, scope) =>
            fixHistoryCutoff(ownerTx, {
              ...scope,
              organizationId: organizationId(scope.organizationId),
              propertyId: propertyId(scope.propertyId),
            }),
        },
        NOW,
      ),
    )
    await expect(store.getProgress(ORG_A, USER_ID, work.id)).resolves.toMatchObject({
      status: 'completed',
      processedCount: 1,
      counts: { pending: 0, imported: 1 },
    })
  })
})
