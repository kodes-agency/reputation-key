import { GOOGLE_BUSINESS_MANAGE_SCOPE } from '#/contexts/integration/provider/contracts'
import { replyScopeEffects } from '#/contexts/reputation/public-api'
import { buildGoogleImportedProperty } from '#/contexts/property/public-api'
import { createPropertyGoogleBindingStore } from '#/contexts/property/profile/google-binding-store.server'
import { createPortalExperienceRepository } from '#/contexts/portal/editor/portal-experience-repository.server'
import { ensureDefaultPublicDisplayName } from '#/contexts/portal/editor/manage-portal-experience.server'
import { admitReviewSync } from '#/contexts/reputation/sync/admit-review-sync.server'
import { createReviewDiscoveryRepository } from '#/contexts/reputation/sync/review-discovery-repository.server'
import type { GoogleReviewApiPort } from '#/contexts/reputation/sync/google-review-api.port.server'
import {
  createReviewProviderSnapshotRepository,
  fixHistoryCutoff,
} from '#/contexts/reputation/sync/review-provider-snapshot-repository.server'
import { runReviewProviderSnapshot } from '#/contexts/reputation/sync/run-review-provider-snapshot.server'
import { createSyncPropertyReviewsHandler } from '#/contexts/reputation/sync/sync-property-reviews-job.server'
import {
  acceptGoogleImportSync,
  admitGoogleImportSync,
} from '#/contexts/reputation/sync/google-import-sync-acceptance.server'
import type { SyncPropertyReviewsJobData } from '#/contexts/reputation/sync/review-queue.port.server'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { buildConsumerEvent, type ConsumerEvent } from '#/shared/outbox/envelope'
import { workItems } from '#/shared/db/schema/work-items.schema'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { properties } from '#/shared/db/schema/property.schema'
import { portalPageEdits } from '#/shared/db/schema/portal-publication.schema'
import {
  propertyPortalBrandContents,
  propertyPortalBrandProfiles,
} from '#/shared/db/schema/portal.schema'
import { googleConnections } from '#/shared/db/schema/google-connection.schema'
import { googleImportItems, googleImports } from '#/shared/db/schema/google-import.schema'
import { idempotencyReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { seedGoogleConnection } from '#/shared/testing/google-connection-seed'
import { drizzleSeedRunner } from '#/shared/db/testing/drizzle-seed-runner'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createDatabase, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, vi } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Job } from 'bullmq'
import type { GoogleImportIntent } from './import-store.port.server'
import { createGoogleImportLifecycle } from './google-import-lifecycle.server'
import { createImportStore } from './import-store.server'
import {
  createGoogleBindingFollowUpHandlers,
  IMPORT_DISPLAY_NAME_CONSUMER,
  IMPORT_SUBSCRIPTION_CONSUMER,
  IMPORT_REVIEW_SYNC_CONSUMER,
} from './google-binding-follow-up-consumers.server'

export const IMPORT_FIXTURE_NOW = new Date('2026-10-20T10:00:00.000Z')

export type FollowUpFault = {
  at: 'before-effect' | 'after-effect' | 'before-ack' | 'after-ack'
  consumer: string
}

/**
 * Registers the lease, store, organisation and connection setup for a real
 * PostgreSQL import suite and returns the builders that suite shares. Call it
 * inside a `describe` block; pass an organisation prefix unique to the file so
 * suites running in parallel never clear each other's rows.
 */
export function useImportStoreFixtures(options: { orgPrefix: string }) {
  const NOW = IMPORT_FIXTURE_NOW
  const ORG_A = `${options.orgPrefix}-a`
  const ORG_B = `${options.orgPrefix}-b`
  const USER_ID = `${options.orgPrefix}-user`
  const CONNECTION_A = randomUUID()
  const CONNECTION_B = randomUUID()
  const ORGS = [ORG_A, ORG_B]
  let lease: TestLease
  let db: Database
  let store: ReturnType<typeof createImportStore>

  function intent(orgId = ORG_A, count = 1, now = NOW): GoogleImportIntent {
    const requestId = randomUUID()
    const connectionId = orgId === ORG_A ? CONNECTION_A : CONNECTION_B
    return {
      id: requestId,
      requestId,
      organizationId: orgId,
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
          organizationId: orgId,
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

  async function clearWork() {
    await db
      .delete(idempotencyReceipts)
      .where(
        sql`${idempotencyReceipts.payload}->>'organizationId' IN (${ORG_A}, ${ORG_B})`,
      )
    await db.delete(googleImports).where(inArray(googleImports.organizationId, ORGS))
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

  const propertyApi = () => createPropertyGoogleBindingStore(db, replyScopeEffects)
  const snapshots = () =>
    createReviewProviderSnapshotRepository(db, randomUUID, replyScopeEffects)
  const prepareImportSync = (
    tx: Parameters<typeof fixHistoryCutoff>[0],
    scope: { organizationId: string; propertyId: string; [key: string]: unknown },
  ) =>
    fixHistoryCutoff(tx, {
      ...scope,
      organizationId: organizationId(scope.organizationId),
      propertyId: propertyId(scope.propertyId),
    } as Parameters<typeof fixHistoryCutoff>[1])
  const restoreDeps = () => ({
    readReceipt: propertyApi().readReceipt,
    ensureImportFollowUps: propertyApi().ensureImportFollowUps,
    prepareImportSync,
  })
  const sourceEpoch = {
    getSourceEpoch: async (
      org: ReturnType<typeof organizationId>,
      id: ReturnType<typeof propertyId>,
    ) => {
      const binding = await propertyApi().readInternal(org, id)
      return binding ? { sourceEpoch: binding.sourceEpoch } : null
    },
  }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 6)
    db = createDatabase(lease.pool)
    store = createImportStore(db, () => NOW, {
      ensureImportFollowUps: propertyApi().ensureImportFollowUps,
      readReceipt: propertyApi().readReceipt,
      prepareImportSync,
    })
    registerAllEventSchemas()
    await clearWork()
    await db
      .delete(googleConnections)
      .where(inArray(googleConnections.organizationId, ORGS))
    await deleteTestOrganizations(db, ORGS)
    for (const orgId of ORGS) {
      await db.execute(sql`
        INSERT INTO organization (id, name, slug, "createdAt")
        VALUES (${orgId}, 'Google import recovery', ${orgId}, ${NOW})
      `)
      await seedGoogleConnection(drizzleSeedRunner(db), {
        id: orgId === ORG_A ? CONNECTION_A : CONNECTION_B,
        organizationId: orgId,
        googleSubject: orgId,
        accessToken: 'test-access',
        refreshToken: 'test-refresh',
        tokenExpiresAt: new Date(NOW.getTime() + 86_400_000),
        scopes: [GOOGLE_BUSINESS_MANAGE_SCOPE],
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

  async function commit(orgId = ORG_A, count = 1, now = NOW) {
    const work = intent(orgId, count, now)
    await expect(store.commitImport(work)).resolves.toBe('committed')
    return work
  }

  async function readItem(itemId: string) {
    const [item] = await db
      .select()
      .from(googleImportItems)
      .where(eq(googleImportItems.id, itemId))
    if (!item) throw new Error('missing recovery fixture')
    return item
  }

  async function createProperty(work: GoogleImportIntent) {
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
    createGoogleImportLifecycle({
      store,
      propertyBindingApi: propertyApi(),
      clock: () => now,
      newEventId: randomUUID,
    })

  async function bindingEvent(work: GoogleImportIntent): Promise<ConsumerEvent> {
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

  async function committedProperty() {
    const work = await commit()
    await createProperty(work)
    return { work, event: await bindingEvent(work) }
  }

  async function markPublished(
    eventId: string,
    extra: { consumerRedeliveryAttempts?: number } = {},
  ) {
    await db
      .update(outboxEvents)
      .set({ publishedAt: NOW, ...extra })
      .where(eq(outboxEvents.id, eventId))
  }

  function followUps(
    fault?: FollowUpFault,
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
    const runNext = () =>
      worker({ data: queue.shift()! } as Job<SyncPropertyReviewsJobData>)
    return {
      handlers: createGoogleBindingFollowUpHandlers(deps),
      receipts,
      queue,
      worker,
      runNext,
      portalRepo,
      desiredSubscriptions,
      discoveryRepo,
    }
  }

  return {
    NOW,
    ORG_A,
    ORG_B,
    USER_ID,
    get db() {
      return db
    },
    get store() {
      return store
    },
    get lease() {
      return lease
    },
    intent,
    commit,
    readItem,
    propertyApi,
    snapshots,
    createProperty,
    lifecycle,
    bindingEvent,
    committedProperty,
    markPublished,
    restoreDeps,
    followUps,
  }
}
