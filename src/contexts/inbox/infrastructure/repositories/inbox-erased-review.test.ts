// Inbox context — an Inbox item whose Review Google deleted (S10-02).
// Real PostgreSQL behind the real Review repository.
//
// The snapshot sync erases a deleted Review (`provider_deleted`) and Inbox
// closes its item with `source_ineligible`. The item stays in the list and the
// Closed queue shows it. Every Inbox read of the Review used to go through a
// finder that threw `invalid_row` for the erased row, so one such item made
// the whole Closed queue page, the item's own detail, a reopen, a bulk reopen
// and the projection rebuild fail. Each of those reads was written for an
// absent Review: the page renders the item without content, the detail says
// the content is not found, a reopen says the source is unavailable, a bulk
// reopen sees a short result and a rebuild has nothing to repair.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  eraseKeepingContentClock,
  insertLiveReview,
} from '#/shared/testing/review-tombstone-fixtures'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { createReviewRepository } from '#/contexts/review/infrastructure/repositories/review.repository'
import { createReplyRepository } from '#/contexts/review/infrastructure/repositories/reply.repository'
import { createEligibleReads } from '#/contexts/review/application/eligible-reads'
import type { InboxItem } from '../../domain/types'
import { inboxItemStatusChanged } from '../../domain/events'
import { updateInboxStatus } from '../../application/use-cases/update-inbox-status'
import { bulkUpdateInboxStatus } from '../../application/use-cases/bulk-update-inbox-status'
import { rebuildInboxProjection } from '../../application/use-cases/rebuild-inbox-projection'
import type { ReviewResponseTargetAuthorityPort } from '../../application/ports/review-response-target-authority.port'
import type { FeedbackLookupPort } from '../../application/ports/feedback-lookup.port'
import type { PropertyLookupPort } from '../../application/ports/property-lookup.port'
import { createAtomicInboxCommandStore } from '../inbox-command-store'
import { createReviewHandlingCycleStore } from '../review-handling-cycle.store'
import { createReviewSourceLookupAdapter } from '../adapters/review-source-lookup.adapter'
import { createReplyLookupAdapter } from '../adapters/reply-lookup.adapter'
import { createInboxRepository } from './inbox.repository'

const ORG = organizationId('org-inbox-erased-review-1111111111')
const PROPERTY = propertyId('7e300000-0000-4000-8000-000000000001')
const LIVE_REVIEW = reviewId('7e300000-0000-4000-8000-0000000000a1')
const ERASED_REVIEW = reviewId('7e300000-0000-4000-8000-0000000000a2')
const LIVE_CLOSED_REVIEW = reviewId('7e300000-0000-4000-8000-0000000000a3')
const UNTRACKED_REVIEW = reviewId('7e300000-0000-4000-8000-0000000000a4')
const LIVE_ITEM = inboxItemId('7e300000-0000-4000-8000-0000000000b1')
const ERASED_ITEM = inboxItemId('7e300000-0000-4000-8000-0000000000b2')
const LIVE_CLOSED_ITEM = inboxItemId('7e300000-0000-4000-8000-0000000000b3')
const MANAGER = userId('user-inbox-erased-review')

const NOW = new Date('2026-10-14T09:00:00.000Z')
const REVIEWED_AT = new Date('2026-10-01T12:00:00.000Z')
// Fetched on the day of the review, so the clock is still running at NOW.
const CLOCK_STILL_RUNNING = new Date('2026-11-01T12:00:00.000Z')

let pool: Pool
const db = getDb()
const logger = createMockLogger()
const reviewRepo = createReviewRepository(db, () => NOW)
const replyRepo = createReplyRepository(db, () => NOW)
const commandStore = createAtomicInboxCommandStore(
  db,
  async () => ({ allowed: true }),
  () => NOW,
)

const feedbackLookup: FeedbackLookupPort = {
  getFeedbackSnippetById: async () => null,
  getFeedbackSnippetsByIds: async () => new Map(),
  findEligibleFeedbackIds: async () => [],
}
const propertyLookup: PropertyLookupPort = {
  getPropertyNameById: async () => null,
  getPropertyNamesByIds: async () => new Map(),
}
const inboxRepo = createInboxRepository(
  db,
  {
    reviewLookup: createEligibleReads({ reviewRepo, clock: () => NOW }),
    feedbackLookup,
    propertyLookup,
  },
  { clock: () => NOW, logger },
)
const reviewSourceLookup = createReviewSourceLookupAdapter({
  findById: (id, orgId) => reviewRepo.findById(id, orgId),
  findByIds: (ids, orgId) => reviewRepo.findByIds(ids, orgId),
  findByOrganizationId: (orgId) => reviewRepo.findByOrganizationId(orgId),
  findByPropertyId: (pid, orgId) => reviewRepo.findByPropertyId(pid, orgId),
})
// A reopen that reaches Review's authority has already read the source, so
// every case below must be answered before it. Reaching it is a failure.
const unreachableAuthority: ReviewResponseTargetAuthorityPort = {
  withExactCurrent: async () => {
    throw new Error('the Response Target authority must not be reached')
  },
  withExactCurrentBatch: async () => {
    throw new Error('the Response Target authority must not be reached')
  },
  withInboxProjection: async () => {
    throw new Error('the Response Target authority must not be reached')
  },
}
const staffPublicApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}
const admin = {
  organizationId: ORG,
  userId: MANAGER,
  role: 'AccountAdmin',
} as AuthContext

async function clean(): Promise<void> {
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
}

async function seedTenant(): Promise<void> {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Inbox erased review', $2, NOW())`,
    [ORG, `inbox-erased-review-${process.pid}`],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Inbox erased review property', $3, 'UTC', NOW(), NOW())`,
    [PROPERTY, ORG, `inbox-erased-review-property-${process.pid}`],
  )
}

/** A live Review at its first Material Review Revision, with its revision row. */
async function seedReview(id: string, externalId: string, text: string): Promise<void> {
  await insertLiveReview(pool, {
    id,
    organizationId: ORG,
    propertyId: PROPERTY,
    externalId,
    text,
    sourceRevision: 1,
    reviewedAt: REVIEWED_AT,
    lastFetchedAt: REVIEWED_AT,
    contentExpiresAt: CLOCK_STILL_RUNNING,
  })
  await pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, content_state, created_at, updated_at
     ) VALUES ($1, 1, $2, $3, 0, 'review-material-v1', $4, $4, 5, $5,
               'active', $6, $6)`,
    [id, ORG, PROPERTY, '1'.repeat(64), text, REVIEWED_AT],
  )
}

function reviewItem(id: InboxItem['id'], sourceId: InboxItem['sourceId']): InboxItem {
  return {
    id,
    organizationId: ORG,
    propertyId: PROPERTY,
    sourceType: 'review',
    sourceId,
    status: 'open',
    rating: null,
    sourceDate: REVIEWED_AT,
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
    createdAt: REVIEWED_AT,
    updatedAt: REVIEWED_AT,
  }
}

/** Inbox's own reaction to a Review source transition: close with `source_ineligible`. */
async function closeAsSourceIneligible(item: InboxItem, eventId: string): Promise<void> {
  await pool.query(
    `INSERT INTO outbox_events (
       id, event_type, event_version, payload, organization_id, property_id,
       source_context, source_aggregate_id, created_at
     ) VALUES ($1, 'review.source.transitioned', 1, '{}'::jsonb, $2, $3,
               'review', $4, $5)`,
    [eventId, ORG, PROPERTY, item.sourceId, NOW],
  )
  await commandStore.applyReviewSourceTransitionedOnce({
    eventId,
    consumerName: 'inbox.on-review-source-transitioned',
    item,
    transitionedAt: NOW,
    closeIfOpen: true,
    closeReason: 'source_ineligible',
    closeFact: inboxItemStatusChanged({
      inboxItemId: item.id,
      organizationId: item.organizationId,
      propertyId: item.propertyId,
      oldStatus: 'open',
      newStatus: 'closed',
      occurredAt: NOW,
    }),
  })
}

async function currentRevisionOf(id: InboxItem['id']): Promise<number> {
  const item = await inboxRepo.findById(id, ORG)
  if (!item) throw new Error('the item is missing')
  return item.commandRevision
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  clearEventSchemas()
  registerAllEventSchemas()
  await clean()
})

afterAll(async () => {
  await clean()
  clearEventSchemas()
  await pool.end()
})

beforeEach(async () => {
  await clean()
  await seedTenant()
  await seedReview(LIVE_REVIEW, 'inbox-erased-live', 'Lovely stay')
  await seedReview(LIVE_CLOSED_REVIEW, 'inbox-erased-live-closed', 'Quiet room')
  await seedReview(ERASED_REVIEW, 'inbox-erased-deleted', 'Words Google took back')
  for (const [item, sourceId] of [
    [LIVE_ITEM, LIVE_REVIEW],
    [LIVE_CLOSED_ITEM, LIVE_CLOSED_REVIEW],
    [ERASED_ITEM, ERASED_REVIEW],
  ] as const) {
    await commandStore.createItem(reviewItem(item, sourceId), null, {
      materialReviewRevision: 1,
    })
  }
  // Google deletes the review: the sync erases the Review row and keeps the
  // content clock it had (the beta's one existing tombstone has exactly this
  // shape), and Inbox closes the item.
  await eraseKeepingContentClock(pool, {
    id: ERASED_REVIEW,
    organizationId: ORG,
    propertyId: PROPERTY,
  })
  await closeAsSourceIneligible(
    reviewItem(ERASED_ITEM, ERASED_REVIEW),
    '7e300000-0000-4000-8000-0000000000e2',
  )
  await closeAsSourceIneligible(
    reviewItem(LIVE_CLOSED_ITEM, LIVE_CLOSED_REVIEW),
    '7e300000-0000-4000-8000-0000000000e3',
  )
})

describe.sequential('an Inbox item whose Review Google deleted', () => {
  it('the Closed queue lists it without content instead of failing the page', async () => {
    const page = await inboxRepo.findFilteredPaginated({ status: 'closed' }, ORG)

    expect(page.totalCount).toBe(2)
    const erased = page.items.find((item) => item.id === ERASED_ITEM)
    expect(erased).toMatchObject({
      status: 'closed',
      rating: null,
      snippet: null,
      reviewerName: null,
      contentAvailability: 'unavailable',
    })
    // The live closed item on the same page keeps its words.
    expect(page.items.find((item) => item.id === LIVE_CLOSED_ITEM)).toMatchObject({
      snippet: 'Quiet room',
      contentAvailability: 'text',
    })
  })

  it('a page of every status still shows the live items next to it', async () => {
    const page = await inboxRepo.findFilteredPaginated({}, ORG)

    expect(page.items.map((item) => item.id).sort()).toEqual(
      [LIVE_ITEM, LIVE_CLOSED_ITEM, ERASED_ITEM].sort(),
    )
    expect(page.items.find((item) => item.id === LIVE_ITEM)).toMatchObject({
      snippet: 'Lovely stay',
      rating: 5,
    })
  })

  it('its detail says the content is not found', async () => {
    const detail = await inboxRepo.findDetailById(ERASED_ITEM, ORG)

    expect(detail).toMatchObject({
      item: { id: ERASED_ITEM, status: 'closed' },
      reviewContentStatus: 'not_found',
      reviewText: null,
      reviewerProfilePhotoUrl: null,
    })
  })

  it('a reopen says the Review source is unavailable', async () => {
    const reopen = updateInboxStatus({
      repo: inboxRepo,
      commandStore,
      clock: () => NOW,
      staffPublicApi,
      cycleStore: createReviewHandlingCycleStore(db),
      reviewSourceLookup,
      responseTargetAuthority: unreachableAuthority,
    })

    await expect(
      reopen(
        {
          inboxItemId: ERASED_ITEM,
          newStatus: 'open',
          expectedCommandRevision: await currentRevisionOf(ERASED_ITEM),
          reopenReason: 'new_information',
        },
        admin,
      ),
    ).rejects.toMatchObject({
      _tag: 'InboxError',
      code: 'not_found',
      message: 'Review source is unavailable',
    })
  })

  it('a bulk reopen that includes it sees a short result and asks for a reload', async () => {
    const bulkReopen = bulkUpdateInboxStatus({
      repo: inboxRepo,
      commandStore,
      clock: () => NOW,
      idGen: () => '7e300000-0000-4000-8000-0000000000f1',
      staffPublicApi,
      reviewSourceLookup,
      responseTargetAuthority: unreachableAuthority,
      logger,
    })

    await expect(
      bulkReopen(
        {
          items: [
            {
              inboxItemId: LIVE_CLOSED_ITEM,
              expectedCommandRevision: await currentRevisionOf(LIVE_CLOSED_ITEM),
            },
            {
              inboxItemId: ERASED_ITEM,
              expectedCommandRevision: await currentRevisionOf(ERASED_ITEM),
            },
          ],
          newStatus: 'open',
          reopenReason: 'new_information',
        },
        admin,
      ),
    ).rejects.toMatchObject({
      _tag: 'InboxError',
      code: 'revision_conflict',
      message: 'A Review source changed; reload and retry',
    })
  })

  it('the projection rebuild repairs the live Reviews and leaves it alone', async () => {
    await seedReview(UNTRACKED_REVIEW, 'inbox-erased-untracked', 'No item yet')
    const rebuild = rebuildInboxProjection({
      repo: inboxRepo,
      commandStore,
      reviewSourceLookup,
      replyLookup: createReplyLookupAdapter({
        findByReviewId: (id, orgId) => replyRepo.findByReviewId(id, orgId),
        getCurrentGoogleReplyByReviewId: async () => null,
        findMilestonesByReviewIds: (ids, orgId) =>
          replyRepo.findMilestonesByReviewIds(ids, orgId),
        findStatesByReviewIds: (ids, orgId) =>
          replyRepo.findStatesByReviewIds(ids, orgId),
        findReviewIdsByReplyStage: (orgId, propertyIds) =>
          replyRepo.findReviewIdsByReplyStage(orgId, propertyIds),
      }),
      idGen: () => inboxItemId(crypto.randomUUID()),
      clock: () => NOW,
      logger,
    })

    const report = await rebuild({ organizationId: ORG, dryRun: false })

    // Three existing items and the three live Reviews are examined: the erased
    // one is not a canonical source, so it is neither counted nor re-created.
    expect(report).toEqual({
      scanned: 6,
      created: 1,
      closed: 0,
      milestones: 0,
      dryRun: false,
    })
    await expect(
      inboxRepo.findBySource('review', UNTRACKED_REVIEW, ORG),
    ).resolves.toMatchObject({ status: 'open' })
    await expect(inboxRepo.findById(ERASED_ITEM, ORG)).resolves.toMatchObject({
      status: 'closed',
    })
  })
})
