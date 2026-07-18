// BQC-3.4 — inbox command store + rebuild integration tests (real Postgres).
//
// Crash-boundary proofs on the real database:
//   1. applyReviewCreatedOnce commits item + created fact + receipt in ONE
//      transaction; a forced outbox failure (unregistered fact type) or a
//      forced receipt failure (missing source event row → FK violation)
//      rolls back EVERYTHING — no item row survives.
//   2. Duplicate delivery: exactly one item, one fact, receipt present.
//   3. applyReviewExpiredOnce: guarded close + status_changed fact + receipt
//      are atomic (the pre-BQC-3.4 crash window is gone).
//   4. rebuildInboxProjection heals a corrupted projection from canonical
//      review/reply data; dryRun writes nothing.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  replyId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import type { Reply, Review } from '#/contexts/review/domain/types'
import { inboxItemCreated, inboxItemStatusChanged } from '../../domain/events'
import { reviewCreated } from '#/contexts/review/domain/events'
import { createInboxRepository } from './inbox.repository'
import { createReviewRepository } from '#/contexts/review/infrastructure/repositories/review.repository'
import { createReplyRepository } from '#/contexts/review/infrastructure/repositories/reply.repository'
import { createAtomicInboxCommandStore } from '../inbox-command-store'
import { createReviewSourceLookupAdapter } from '../adapters/review-source-lookup.adapter'
import { createReplyLookupAdapter } from '../adapters/reply-lookup.adapter'
import { rebuildInboxProjection } from '../../application/use-cases/rebuild-inbox-projection'
import type {
  ReviewLookupPort,
  ReviewSnippetResult,
} from '../../application/ports/review-lookup.port'
import type { FeedbackLookupPort } from '../../application/ports/feedback-lookup.port'
import type { PropertyLookupPort } from '../../application/ports/property-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'

const ORG_A = organizationId('org-inbox-cmd-aaaa-1111111111111111')
const PROP_A = propertyId('4d000000-0000-0000-0000-000000000001')
const USER_A = userId('user-inbox-cmd-aaaa-1111111111')
const REVIEW_A = reviewId('4d000000-0000-0000-0000-000000000010')
const ITEM_A = inboxItemId('4d000000-0000-0000-0000-000000000020')
const NOW = new Date('2026-06-01T12:00:00.000Z')
const CONSUMER = 'inbox.on-review-created'

let pool: Pool
const db = getDb()

const silentEvents: EventBus = {
  on: () => {},
  emit: async () => {},
  clear: () => {},
}

const noopLogger: LoggerPort = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
}

// Stub enrichment ports — inbox repo owns the SQL, these just answer lookups.
const stubPorts = {
  reviewLookup: {
    getReviewSnippetById: async (): Promise<ReviewSnippetResult> => ({
      status: 'not_found',
    }),
    getReviewSnippetsByIds: async () => new Map(),
    findEligibleReviewIds: async () => [] as string[],
  } satisfies ReviewLookupPort,
  feedbackLookup: {
    getFeedbackSnippetById: async () => null,
  } satisfies FeedbackLookupPort,
  propertyLookup: {
    getPropertyNameById: async () => null,
    getPropertyNamesByIds: async () => new Map(),
  } satisfies PropertyLookupPort,
}

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: ITEM_A,
    organizationId: ORG_A,
    propertyId: PROP_A,
    sourceType: 'review',
    sourceId: REVIEW_A,
    status: 'open',
    rating: null,
    sourceDate: NOW,
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: REVIEW_A,
    organizationId: ORG_A,
    propertyId: PROP_A,
    platform: 'google',
    externalId: `ext-${crypto.randomUUID()}`,
    externalLocationId: 'accounts/111/locations/222',
    googleConnectionId: null,
    reviewerName: 'Jane Doe',
    reviewerProfilePhotoUrl: null,
    rating: 5,
    text: 'Great place!',
    languageCode: 'en',
    reviewedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 25 * 24 * 60 * 60 * 1000),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: NOW,
    sourceUpdatedAt: null,
    firstFetchedAt: NOW,
    lastFetchedAt: NOW,
    contentExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
    contentHash: null,
    sourceSeenGeneration: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeReply(overrides: Partial<Reply> = {}): Reply {
  return {
    id: replyId(crypto.randomUUID()),
    reviewId: REVIEW_A,
    organizationId: ORG_A,
    text: 'Thanks!',
    status: 'published',
    source: 'internal',
    createdBy: USER_A,
    approvedBy: USER_A,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    submittedAt: new Date('2026-05-28T10:00:00.000Z'),
    approvedAt: new Date('2026-05-28T11:00:00.000Z'),
    publishedAt: new Date('2026-05-29T10:00:00.000Z'),
    publicationState: 'published',
    publicationAttempts: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

async function seedOrgAndProperty(p: Pool) {
  const slug = 't-' + ORG_A.replace(/-/g, '').slice(-12)
  await p.query(`DELETE FROM organization WHERE slug = $1 AND id <> $2`, [slug, ORG_A])
  await p.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name`,
    [ORG_A, `Test Org ${slug}`, slug],
  )
  await p.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROP_A, ORG_A, 'Inbox Cmd Property', 'inbox-cmd-prop', 'UTC'],
  )
}

async function truncateAll(p: Pool) {
  await p.query('DELETE FROM inbox_notes WHERE organization_id = $1', [ORG_A])
  await p.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG_A])
  await p.query('DELETE FROM replies WHERE organization_id = $1', [ORG_A])
  await p.query('DELETE FROM reviews WHERE organization_id = $1', [ORG_A])
  // Receipts cascade from outbox_events.
  await p.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG_A])
}

/** Insert the delivered source event row (receipts FK to outbox_events.id). */
async function insertSourceEvent(event: DomainEvent): Promise<void> {
  await createOutboxRepository(db).insert({ ...toOutboxEvent(event), id: event.eventId })
}

const createdFact = (item: InboxItem) =>
  inboxItemCreated({
    inboxItemId: item.id,
    organizationId: item.organizationId,
    propertyId: item.propertyId,
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    occurredAt: item.createdAt,
  })

beforeAll(async () => {
  const env = getEnv()
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 })
  const client = await pool.connect()
  client.release()
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  clearEventSchemas()
  await truncateAll(pool)
  await pool.end()
})

beforeEach(async () => {
  await truncateAll(pool)
  await seedOrgAndProperty(pool)
})

describe.sequential('inboxCommandStore applyOnce (integration)', () => {
  it('applyReviewCreatedOnce commits item + fact + receipt in one transaction', async () => {
    const store = createAtomicInboxCommandStore(db, silentEvents)
    const source = reviewCreated({
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      platform: 'google',
      externalId: 'ext-1',
      occurredAt: NOW,
    })
    await insertSourceEvent(source)

    const item = makeItem()
    const fact = createdFact(item)
    const outcome = await store.applyReviewCreatedOnce({
      eventId: source.eventId,
      consumerName: CONSUMER,
      item,
      fact,
    })

    expect(outcome).toBe('applied')
    const items = await pool.query(
      'SELECT * FROM inbox_items WHERE organization_id = $1',
      [ORG_A],
    )
    expect(items.rows).toHaveLength(1)
    const facts = await pool.query(
      `SELECT id, event_type, payload FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'inbox.inbox_item.created'`,
      [ORG_A],
    )
    expect(facts.rows).toHaveLength(1)
    expect(facts.rows[0].id).toBe(fact.eventId)
    const receipts = await pool.query(
      `SELECT consumer_name, status FROM event_consumer_receipts WHERE event_id = $1`,
      [source.eventId],
    )
    expect(receipts.rows).toEqual([{ consumer_name: CONSUMER, status: 'applied' }])
  })

  it('rolls back the item insert when the fact insert fails (unregistered type)', async () => {
    const store = createAtomicInboxCommandStore(db, silentEvents)
    const source = reviewCreated({
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      platform: 'google',
      externalId: 'ext-1',
      occurredAt: NOW,
    })
    await insertSourceEvent(source)

    const ghost = {
      ...createdFact(makeItem()),
      _tag: 'inbox.inbox_item.ghost',
    } as unknown as Parameters<typeof store.applyReviewCreatedOnce>[0]['fact']

    await expect(
      store.applyReviewCreatedOnce({
        eventId: source.eventId,
        consumerName: CONSUMER,
        item: makeItem(),
        fact: ghost,
      }),
    ).rejects.toThrow()

    const items = await pool.query(
      'SELECT id FROM inbox_items WHERE organization_id = $1',
      [ORG_A],
    )
    expect(items.rows).toHaveLength(0)
    const receipts = await pool.query(
      'SELECT event_id FROM event_consumer_receipts WHERE event_id = $1',
      [source.eventId],
    )
    expect(receipts.rows).toHaveLength(0)
  })

  it('rolls back item + fact when the receipt insert fails (source event row missing)', async () => {
    const store = createAtomicInboxCommandStore(db, silentEvents)
    // No source outbox row — the receipt FK to outbox_events.id fails inside
    // the transaction, proving state+fact+receipt are one commit.
    const ghostEventId = crypto.randomUUID()

    await expect(
      store.applyReviewCreatedOnce({
        eventId: ghostEventId,
        consumerName: CONSUMER,
        item: makeItem(),
        fact: createdFact(makeItem()),
      }),
    ).rejects.toThrow()

    const items = await pool.query(
      'SELECT id FROM inbox_items WHERE organization_id = $1',
      [ORG_A],
    )
    expect(items.rows).toHaveLength(0)
    const facts = await pool.query(
      `SELECT id FROM outbox_events WHERE organization_id = $1 AND event_type = 'inbox.inbox_item.created'`,
      [ORG_A],
    )
    expect(facts.rows).toHaveLength(0)
  })

  it('duplicate delivery: exactly one item, one fact, receipt present', async () => {
    const store = createAtomicInboxCommandStore(db, silentEvents)
    const source = reviewCreated({
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      platform: 'google',
      externalId: 'ext-1',
      occurredAt: NOW,
    })
    await insertSourceEvent(source)

    const item = makeItem()
    const first = await store.applyReviewCreatedOnce({
      eventId: source.eventId,
      consumerName: CONSUMER,
      item,
      fact: createdFact(item),
    })
    // Same delivered event again (replay after the receipt pre-check raced).
    const second = await store.applyReviewCreatedOnce({
      eventId: source.eventId,
      consumerName: CONSUMER,
      item: makeItem({ id: inboxItemId(crypto.randomUUID()) }),
      fact: createdFact(item),
    })

    expect(first).toBe('applied')
    expect(second).toBe('duplicate')
    const items = await pool.query(
      'SELECT id FROM inbox_items WHERE organization_id = $1',
      [ORG_A],
    )
    expect(items.rows).toHaveLength(1)
    const facts = await pool.query(
      `SELECT id FROM outbox_events WHERE organization_id = $1 AND event_type = 'inbox.inbox_item.created'`,
      [ORG_A],
    )
    expect(facts.rows).toHaveLength(1)
    const receipts = await pool.query(
      'SELECT event_id FROM event_consumer_receipts WHERE event_id = $1',
      [source.eventId],
    )
    expect(receipts.rows).toHaveLength(1)
  })

  it('applyReviewExpiredOnce closes the item and commits fact + receipt atomically', async () => {
    const repo = createInboxRepository(db, stubPorts)
    const store = createAtomicInboxCommandStore(db, silentEvents)
    await repo.create(makeItem(), ORG_A)

    const source = reviewCreated({
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      platform: 'google',
      externalId: 'ext-1',
      occurredAt: NOW,
    })
    await insertSourceEvent(source)

    const fact = inboxItemStatusChanged({
      inboxItemId: ITEM_A,
      organizationId: ORG_A,
      propertyId: PROP_A,
      oldStatus: 'open',
      newStatus: 'closed',
      occurredAt: NOW,
    })
    const outcome = await store.applyReviewExpiredOnce({
      eventId: source.eventId,
      consumerName: 'inbox.on-review-expired',
      item: makeItem(),
      now: NOW,
      fact,
    })

    expect(outcome).toBe('applied')
    const persisted = await repo.findById(ITEM_A, ORG_A)
    expect(persisted?.status).toBe('closed')
    expect(persisted?.closedAt).toEqual(NOW)
    const facts = await pool.query(
      `SELECT id FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'inbox.inbox_item.status_changed'`,
      [ORG_A],
    )
    expect(facts.rows).toHaveLength(1)
    const receipts = await pool.query(
      `SELECT consumer_name, status FROM event_consumer_receipts WHERE event_id = $1`,
      [source.eventId],
    )
    expect(receipts.rows).toEqual([
      { consumer_name: 'inbox.on-review-expired', status: 'applied' },
    ])
  })
})

describe.sequential('rebuildInboxProjection (integration)', () => {
  function makeRebuild() {
    const reviewRepo = createReviewRepository(db)
    const replyRepo = createReplyRepository(db)
    const repo = createInboxRepository(db, stubPorts)
    const commandStore = createAtomicInboxCommandStore(db, silentEvents)
    const useCase = rebuildInboxProjection({
      repo,
      commandStore,
      reviewSourceLookup: createReviewSourceLookupAdapter({
        findById: (id, orgId) => reviewRepo.findById(id, orgId),
        findByOrganizationId: (orgId) => reviewRepo.findByOrganizationId(orgId),
        findByPropertyId: (pid, orgId) => reviewRepo.findByPropertyId(pid, orgId),
      }),
      replyLookup: createReplyLookupAdapter({
        findInternalByReviewId: (id, orgId) =>
          replyRepo.findInternalByReviewId(id, orgId),
        findByReviewId: (id, orgId) => replyRepo.findByReviewId(id, orgId),
      }),
      idGen: () => inboxItemId(crypto.randomUUID()),
      clock: () => NOW,
      logger: noopLogger,
    })
    return { useCase, repo, reviewRepo, replyRepo }
  }

  async function seedCanonicalState() {
    const { reviewRepo, replyRepo, repo } = makeRebuild()
    // LIVE-PUBLISHED: review live, item open, published reply — heal = close
    // + milestones + status_changed fact.
    const livePublished = makeReview({
      id: reviewId('4d000000-0000-0000-0000-000000000011'),
    })
    await reviewRepo.upsert(livePublished)
    await replyRepo.upsert(makeReply({ reviewId: livePublished.id }))
    await repo.create(
      makeItem({
        id: inboxItemId('4d000000-0000-0000-0000-000000000021'),
        sourceId: livePublished.id,
      }),
      ORG_A,
    )
    // MISSING: review live, no item — heal = create (no created fact).
    const missing = makeReview({ id: reviewId('4d000000-0000-0000-0000-000000000012') })
    await reviewRepo.upsert(missing)
    // EXPIRED: content clock past — heal = close + fact.
    const expired = makeReview({
      id: reviewId('4d000000-0000-0000-0000-000000000013'),
      contentExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    await reviewRepo.upsert(expired)
    await repo.create(
      makeItem({
        id: inboxItemId('4d000000-0000-0000-0000-000000000022'),
        sourceId: expired.id,
      }),
      ORG_A,
    )
    // PURGED: item whose review row is gone — heal = close + fact.
    await repo.create(
      makeItem({
        id: inboxItemId('4d000000-0000-0000-0000-000000000023'),
        sourceId: reviewId('4d000000-0000-0000-0000-000000000099'),
      }),
      ORG_A,
    )
    // HEALTHY: live review, item closed with milestones — no change.
    const healthy = makeReview({ id: reviewId('4d000000-0000-0000-0000-000000000014') })
    await reviewRepo.upsert(healthy)
    await repo.create(
      makeItem({
        id: inboxItemId('4d000000-0000-0000-0000-000000000024'),
        sourceId: healthy.id,
        status: 'closed',
        closedAt: NOW,
        firstReplyPublishedAt: NOW,
        assignedTo: USER_A,
        isEscalated: true,
        escalatedAt: NOW,
        escalatedBy: USER_A,
      }),
      ORG_A,
    )
  }

  it('heals a corrupted projection from canonical data and reports it', async () => {
    const { useCase, repo } = makeRebuild()
    await seedCanonicalState()

    const report = await useCase({ organizationId: ORG_A, dryRun: false })

    expect(report.dryRun).toBe(false)
    expect(report.created).toBe(1)
    expect(report.closed).toBe(3)
    expect(report.milestones).toBe(1)
    expect(report.scanned).toBe(8) // 4 items + 4 canonical reviews

    // healed: close + milestones for the live-published item
    const healed = await repo.findById(
      inboxItemId('4d000000-0000-0000-0000-000000000021'),
      ORG_A,
    )
    expect(healed?.status).toBe('closed')
    expect(healed?.firstReplySubmittedAt).toEqual(new Date('2026-05-28T10:00:00.000Z'))
    expect(healed?.firstReplyPublishedAt).toEqual(new Date('2026-05-29T10:00:00.000Z'))

    // created for the missing review (source metadata from canonical data)
    const created = await repo.findBySource(
      'review',
      '4d000000-0000-0000-0000-000000000012',
      ORG_A,
    )
    expect(created).not.toBeNull()
    expect(created?.status).toBe('open')
    expect(created?.sourceDate).toEqual(NOW)

    // expired + purged items closed
    expect(
      (await repo.findById(inboxItemId('4d000000-0000-0000-0000-000000000022'), ORG_A))
        ?.status,
    ).toBe('closed')
    expect(
      (await repo.findById(inboxItemId('4d000000-0000-0000-0000-000000000023'), ORG_A))
        ?.status,
    ).toBe('closed')

    // healthy item untouched — inbox-owned fields preserved
    const healthy = await repo.findById(
      inboxItemId('4d000000-0000-0000-0000-000000000024'),
      ORG_A,
    )
    expect(healthy?.assignedTo).toBe(USER_A)
    expect(healthy?.isEscalated).toBe(true)

    // facts: 3 status_changed (live-published + expired + purged), NO created
    const facts = await pool.query(
      `SELECT event_type, COUNT(*)::int AS n FROM outbox_events
       WHERE organization_id = $1 GROUP BY event_type ORDER BY event_type`,
      [ORG_A],
    )
    expect(facts.rows).toEqual([{ event_type: 'inbox.inbox_item.status_changed', n: 3 }])

    // idempotent: a second run reconciles nothing
    const second = await useCase({ organizationId: ORG_A, dryRun: false })
    expect(second).toMatchObject({ created: 0, closed: 0, milestones: 0 })
  })

  it('dryRun reports the same counts but writes nothing', async () => {
    const { useCase, repo } = makeRebuild()
    await seedCanonicalState()

    const report = await useCase({ organizationId: ORG_A, dryRun: true })

    expect(report).toMatchObject({ created: 1, closed: 3, milestones: 1, dryRun: true })
    const items = await pool.query(
      `SELECT COUNT(*)::int AS n FROM inbox_items WHERE organization_id = $1`,
      [ORG_A],
    )
    expect(items.rows[0].n).toBe(4) // nothing created
    expect(
      (await repo.findById(inboxItemId('4d000000-0000-0000-0000-000000000021'), ORG_A))
        ?.status,
    ).toBe('open') // nothing closed
    const facts = await pool.query(
      'SELECT id FROM outbox_events WHERE organization_id = $1',
      [ORG_A],
    )
    expect(facts.rows).toHaveLength(0)
  })
})
