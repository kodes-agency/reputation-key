import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { reviewSourceTransitioned } from '#/contexts/review/domain/events'
import { createReviewSourceTransitionAuthority } from '#/contexts/review/infrastructure/source-transition-authority'
import { createSourceTransitionAuthorityAdapter } from '#/contexts/inbox/infrastructure/adapters/source-transition-authority.adapter'
import {
  createAtomicInboxCommandStore as createProductionInboxCommandStore,
  type InboxCommandAuthority,
} from '#/contexts/inbox/infrastructure/inbox-command-store'
import { createInboxRepository } from '#/contexts/inbox/infrastructure/repositories/inbox.repository'
import { createReviewHandlingCycleStore } from '#/contexts/inbox/infrastructure/review-handling-cycle.store'
import { handleInboxReviewSourceTransitioned } from '#/contexts/inbox/infrastructure/outbox-consumers'
import type { InboxItem } from '#/contexts/inbox/domain/types'
import type { ReviewLookupPort } from '#/contexts/inbox/application/ports/review-lookup.port'
import type { FeedbackLookupPort } from '#/contexts/inbox/application/ports/feedback-lookup.port'
import type { PropertyLookupPort } from '#/contexts/inbox/application/ports/property-lookup.port'
import type { ReplyObservationAuthorityPort } from '#/contexts/inbox/application/ports/reply-observation-authority.port'
import type { ConsumerEvent } from '#/shared/outbox'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { inboxItemId, organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createMockLogger } from '#/shared/testing/mock-logger'

const ORG = organizationId('org-source-transition-inbox-race')
const PROPERTY = propertyId('ad000000-0000-4000-8000-000000000001')
const REVIEW = reviewId('ad000000-0000-4000-8000-000000000002')
const ITEM = inboxItemId('ad000000-0000-4000-8000-000000000003')
const TRANSITIONED_AT = new Date('2026-08-27T01:00:00.000Z')
const logger = createMockLogger()

let lease: TestLease
let pool: Pool

const allowAllCommandAuthority: InboxCommandAuthority = async () => ({
  allowed: true,
})

const reviewLookup = {
  getReviewSnippetById: async () => ({ status: 'not_found' as const }),
  getReviewSnippetsByIds: async () => new Map(),
  findEligibleReviewIds: async () => [],
} satisfies ReviewLookupPort

const feedbackLookup = {
  getFeedbackSnippetById: async () => null,
  getFeedbackSnippetsByIds: async () => new Map(),
  findEligibleFeedbackIds: async () => [],
} satisfies FeedbackLookupPort

const propertyLookup = {
  getPropertyNameById: async () => null,
  getPropertyNamesByIds: async () => new Map(),
} satisfies PropertyLookupPort

const obsoleteReplyAuthority = {
  withExactCurrent: async () => ({ status: 'obsolete' as const }),
} satisfies ReplyObservationAuthorityPort

const item = (): InboxItem => ({
  id: ITEM,
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceType: 'review',
  sourceId: REVIEW,
  status: 'open',
  rating: null,
  sourceDate: TRANSITIONED_AT,
  platform: 'google',
  snippet: null,
  assignedTo: null,
  reviewerName: null,
  propertyName: null,
  isEscalated: false,
  escalatedAt: null,
  escalatedBy: null,
  escalationResolvedAt: null,
  escalationResolvedBy: null,
  closedAt: null,
  firstReplySubmittedAt: null,
  firstReplyPublishedAt: null,
  commandRevision: 1,
  createdAt: TRANSITIONED_AT,
  updatedAt: TRANSITIONED_AT,
})

const delay = (milliseconds: number): Promise<'still-waiting'> =>
  new Promise((resolve) => {
    setTimeout(() => resolve('still-waiting'), milliseconds)
  })

async function cleanFixtureRows(): Promise<void> {
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 4)
  pool = lease.pool
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  await cleanFixtureRows()
  clearEventSchemas()
  await lease.release()
})

beforeEach(async () => {
  await cleanFixtureRows()
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Source transition Inbox race', $2, NOW())`,
    [ORG, `source-transition-inbox-race-${process.pid}`],
  )
  await pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, source_epoch
     ) VALUES ($1, $2, 'Source transition Inbox race', $3, 'UTC', 0)`,
    [PROPERTY, ORG, `source-transition-inbox-race-${process.pid}`],
  )
  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, source_epoch,
       source_revision, analysis_sequence, source_content_state,
       source_content_erased_at
     ) VALUES ($1, $2, $3, 'google', 0, 3, 7, 'source_expired', $4)`,
    [REVIEW, ORG, PROPERTY, TRANSITIONED_AT],
  )
  await pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, content_state, created_at, updated_at
     ) VALUES (
       $1, 1, $2, $3, 0, 'review-material-v1', $4, $4, 4,
       'historical review text', 'active', $5, $5
     )`,
    [REVIEW, ORG, PROPERTY, '3'.repeat(64), TRANSITIONED_AT],
  )
})

describe.sequential('Review source transition -> Inbox exact-current boundary', () => {
  it('waits for concurrent re-observation, then receipts the stale transition without closing Inbox', async () => {
    const database = getDb()
    const inboxRepo = createInboxRepository(
      database,
      {
        reviewLookup,
        feedbackLookup,
        propertyLookup,
      },
      { clock: () => TRANSITIONED_AT, logger },
    )
    const commandStore = createProductionInboxCommandStore(
      database,
      allowAllCommandAuthority,
      () => TRANSITIONED_AT,
    )
    await commandStore.createItem(item(), null, { materialReviewRevision: 1 })

    const source = reviewSourceTransitioned({
      reviewId: REVIEW,
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceEpoch: 0,
      sourceRevision: 3,
      analysisSequence: 7,
      change: 'source_expired',
      occurredAt: TRANSITIONED_AT,
    })
    await createOutboxRepository(database).insert({
      ...toOutboxEvent(source),
      id: source.eventId,
    })

    const durable = toOutboxEvent(source)
    const event: ConsumerEvent = {
      eventId: source.eventId,
      eventType: durable.eventType,
      eventVersion: 1,
      payload: durable.payload,
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceContext: durable.sourceContext,
      sourceAggregateId: durable.sourceAggregateId,
    }

    const reobserve: PoolClient = await pool.connect()
    let reobserveCommitted = false
    try {
      await reobserve.query('BEGIN')
      await reobserve.query(
        `SELECT source_epoch FROM properties
         WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
        [ORG, PROPERTY],
      )
      await reobserve.query(
        `SELECT pg_advisory_xact_lock(
           hashtextextended($1, 0)
         )`,
        [`google-reply-observation:${ORG}:${REVIEW}`],
      )
      await reobserve.query(
        `SELECT id FROM reviews
         WHERE organization_id = $1 AND property_id = $2 AND id = $3
         FOR UPDATE`,
        [ORG, PROPERTY, REVIEW],
      )
      await reobserve.query(
        `UPDATE reviews
         SET source_content_state = 'active',
             source_content_erased_at = NULL,
             analysis_sequence = 8,
             updated_at = transaction_timestamp()
         WHERE organization_id = $1 AND property_id = $2 AND id = $3`,
        [ORG, PROPERTY, REVIEW],
      )

      let authorityStarted!: () => void
      const started = new Promise<void>((resolve) => {
        authorityStarted = resolve
      })
      const realAuthority = createSourceTransitionAuthorityAdapter(
        createReviewSourceTransitionAuthority(database),
      )
      const guardedAuthority = {
        withExactCurrent: async <T>(
          expectation: Parameters<typeof realAuthority.withExactCurrent<T>>[0],
          apply: Parameters<typeof realAuthority.withExactCurrent<T>>[1],
        ) => {
          authorityStarted()
          return realAuthority.withExactCurrent(expectation, apply)
        },
      }

      const pending = handleInboxReviewSourceTransitioned(
        {
          commandStore,
          handlingCycleStore: createReviewHandlingCycleStore(database),
          replyObservationAuthority: obsoleteReplyAuthority,
          responseTargetAuthority: {
            withExactCurrent: async () => ({ status: 'obsolete' as const }),
            withExactCurrentBatch: async () => ({ status: 'obsolete' as const }),
            withInboxProjection: async () => ({ status: 'obsolete' as const }),
          },
          sourceTransitionAuthority: guardedAuthority,
          reviewLookup,
          reviewSourceLookup: {
            getReviewSourceMetaById: async () => null,
            getReviewSourceMetaByIds: async () => [],
            listReviewSources: async () => [],
          },
          inboxRepo,
          idGen: () => ITEM,
          clock: () => TRANSITIONED_AT,
          logger,
        },
        event,
      )
      await started

      // Without the Review lock this stale consumer can read the old committed
      // tombstone and close Inbox while re-observation is still uncommitted.
      // It must remain pending until the re-observation transaction resolves.
      await expect(Promise.race([pending, delay(100)])).resolves.toBe('still-waiting')
      expect((await inboxRepo.findById(ITEM, ORG))?.status).toBe('open')

      await reobserve.query('COMMIT')
      reobserveCommitted = true

      await expect(pending).resolves.toEqual({ status: 'obsolete' })
      expect((await inboxRepo.findById(ITEM, ORG))?.status).toBe('open')
      const receipts = await pool.query(
        `SELECT consumer_name, status
         FROM event_consumer_receipts WHERE event_id = $1`,
        [source.eventId],
      )
      expect(receipts.rows).toEqual([
        {
          consumer_name: 'inbox.on-review-source-transitioned',
          status: 'obsolete',
        },
      ])
      const facts = await pool.query(
        `SELECT id FROM outbox_events
         WHERE organization_id = $1
           AND event_type = 'inbox.inbox_item.status_changed'`,
        [ORG],
      )
      expect(facts.rows).toHaveLength(0)
    } finally {
      if (!reobserveCommitted) await reobserve.query('ROLLBACK')
      reobserve.release()
    }
  })
})
