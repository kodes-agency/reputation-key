import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { createOutboxRelay } from '#/shared/outbox/relay'
import { reconcileWorkItems } from '#/shared/jobs/work-items.server'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { reviewProviderSnapshotRuns } from '#/shared/db/schema/review.schema'
import { admitGoogleImportSync } from '#/contexts/reputation/sync/google-import-sync-acceptance.server'
import type { GoogleReviewApiPort } from '#/contexts/reputation/sync/google-review-api.port.server'
import type { SyncPropertyReviewsJobData } from '#/contexts/reputation/sync/review-queue.port.server'
import {
  IMPORT_DISPLAY_NAME_CONSUMER,
  IMPORT_SUBSCRIPTION_CONSUMER,
  IMPORT_REVIEW_SYNC_CONSUMER,
} from './google-binding-follow-up-consumers.server'
import { createGoogleImportProcessor } from './google-import-processor.server'
import { createGoogleImportClaimReaper } from './google-import-claim-reaper.server'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import type { Job } from 'bullmq'
import { useImportStoreFixtures } from './import-store.test-fixtures'

const minuteAfter = (at: Date) => new Date(at.getTime() + 60_000)

describe('Google import completion and follow-up crash recovery (real PostgreSQL)', () => {
  const fx = useImportStoreFixtures({ orgPrefix: 'google-import-follow-up' })
  const { NOW, ORG_A, committedProperty, markPublished, followUps } = fx
  const { lifecycle, readItem, propertyApi, snapshots } = fx

  it('recovers follow-ups after Property commit, queue loss, failed recovery, and lifecycle completion', async () => {
    const { work, event } = await committedProperty()
    const follow = followUps({
      at: 'before-effect',
      consumer: IMPORT_DISPLAY_NAME_CONSUMER,
    })
    const recoveryAt = new Date(work.items[0]!.effectDeadlineAt.getTime() + 1)
    const processor = createGoogleImportProcessor({
      store: fx.store,
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
    const recover = createGoogleImportClaimReaper({
      store: fx.store,
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
    await markPublished(event.eventId)
    const repo = createOutboxRepository(fx.db, () => minuteAfter(NOW))
    // Publication without a queue leaves pending work for the independent sweep.
    await createOutboxRelay(repo, undefined).sweep()
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
    await expect(admitGoogleImportSync(fx.db, randomUUID, sync)).resolves.toBeNull()
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
      const { work, event } = await committedProperty()
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
      await follow.runNext()
      const replacement = follow.queue.shift()!
      expect(replacement).not.toHaveProperty('runId')
      await follow.worker({ data: replacement } as Job<SyncPropertyReviewsJobData>)
      expect(follow.queue[0]?.runId).toBeDefined()
      expect(follow.queue[0]?.runId).not.toBe(initial.runId)
      while (follow.queue.length) await follow.runNext()
      const runs = await fx.db
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
      const { event } = await committedProperty()
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
      const runs = await fx.db
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
      const { work, event } = await committedProperty()
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
        await expect(follow.runNext()).rejects.toThrow('worker died')
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
        await follow.runNext()
      } else await handler(event)
      expect(await follow.receipts.hasReceipt(event.eventId, consumer)).toBe(true)
      await expect(handler(event)).resolves.toEqual({ status: 'duplicate' })
      if (consumer === IMPORT_SUBSCRIPTION_CONSUMER)
        expect(follow.desiredSubscriptions.size).toBe(1)
      if (consumer === IMPORT_REVIEW_SYNC_CONSUMER) {
        const runs = await fx.db.execute(
          sql`SELECT count(*)::int AS count FROM review_provider_snapshot_runs WHERE organization_id = ${ORG_A} AND property_id = ${work.items[0]!.destinationPropertyId}`,
        )
        expect(runs.rows[0]).toMatchObject({ count: 1 })
      }
    },
  )
})
