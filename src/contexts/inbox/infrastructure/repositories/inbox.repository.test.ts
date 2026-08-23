// Inbox context — inbox repository integration tests
// Per architecture: integration tests against real Postgres.
// Tenant isolation test is NON-NEGOTIABLE.

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { createInboxRepository, inboxSourceIdMatchesAny } from './inbox.repository'
import { PgDialect } from 'drizzle-orm/pg-core'
import type {
  ReviewLookupPort,
  ReviewSnippetResult,
} from '../../application/ports/review-lookup.port'
import type { FeedbackLookupPort } from '../../application/ports/feedback-lookup.port'
import type { PropertyLookupPort } from '../../application/ports/property-lookup.port'
import type { AiReviewInsightsPort } from '../../application/ports/ai-review-insights.port'
import { getDb } from '#/shared/db'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  feedbackId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'

import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'

const ORG_A = organizationId('org-inbox-test-aaaa-1111111111111111')
const ORG_B = organizationId('org-inbox-test-bbbb-2222222222222222')
const PROP_A = propertyId('1a000000-0000-0000-0000-000000000001')
const PROP_B = propertyId('1b000000-0000-0000-0000-000000000002')
const USER_A = userId('user-inbox-test-aaaa-1111111111111111')
const REVIEW_ID_A = '11111111-1111-1111-1111-111111111111'

let pool: Pool
const db = getDb()

// Stub lookup ports — inbox repo owns the SQL, these just provide enrichment data
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
    getFeedbackSnippetsByIds: async () => new Map(),
    findEligibleFeedbackIds: async () => [],
  } satisfies FeedbackLookupPort,
  propertyLookup: {
    getPropertyNameById: async () => null,
    getPropertyNamesByIds: async () => new Map(),
  } satisfies PropertyLookupPort,
}

it('binds large source-id sets as one PostgreSQL array parameter', () => {
  const ids = Array.from(
    { length: 70_000 },
    (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  )

  const compiled = new PgDialect().sqlToQuery(inboxSourceIdMatchesAny(ids))
  const boundIds = compiled.params[0] as ReadonlyArray<string>

  expect(compiled.sql).toContain('= ANY($1::uuid[])')
  expect(compiled.params).toHaveLength(1)
  expect(boundIds).toHaveLength(ids.length)
  expect(boundIds[0]).toBe(ids[0])
  expect(boundIds.at(-1)).toBe(ids.at(-1))
})

// ── Helpers ──────────────────────────────────────────────────────────

function makeInboxItem(overrides: Partial<InboxItem> = {}): InboxItem {
  const now = new Date()
  return {
    id: inboxItemId(crypto.randomUUID()),
    organizationId: ORG_A,
    propertyId: PROP_A,
    sourceType: 'review',
    sourceId: reviewId(crypto.randomUUID()),
    status: 'open',
    rating: 4,
    sourceDate: now,
    platform: 'google',
    snippet: 'Great service',
    assignedTo: null,
    reviewerName: 'John Doe',
    propertyName: 'Test Hotel',
    isEscalated: false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    closedAt: null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

async function truncateInbox(pool: Pool) {
  await pool.query('DELETE FROM inbox_items WHERE organization_id IN ($1, $2)', [
    ORG_A as string,
    ORG_B as string,
  ])
}

async function seedOrgs(pool: Pool, ids: string[]) {
  for (const id of ids) {
    const slug = 't-' + id.replace(/-/g, '')
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name`,
      [id, `Test Org ${slug}`, slug],
    )
  }
}

async function seedProperties(pool: Pool) {
  const props = [
    { id: PROP_A as string, org: ORG_A as string, slug: 'inbox-test-prop-a' },
    { id: PROP_B as string, org: ORG_B as string, slug: 'inbox-test-prop-b' },
  ]
  for (const p of props) {
    await pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'UTC', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [p.id, p.org, `Test Property ${p.slug}`, p.slug],
    )
  }
}

async function seedReviews(pool: Pool) {
  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, external_id, external_location_id,
       platform, rating, text, reviewer_name, reviewed_at, expires_at,
       source_epoch, source_revision, analysis_sequence,
       ai_source_byte_length, ai_source_digest, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, 'ext-rev-001', 'ext-loc-001',
       'google', 4, 'Great service', 'John Doe', NOW(), NOW() + INTERVAL '1 year',
       0, 0, 0, 1, repeat('0', 64), NOW(), NOW()
     )
     ON CONFLICT (platform, external_id, organization_id) DO NOTHING`,
    [REVIEW_ID_A, ORG_A as string, PROP_A as string],
  )
}

// ── Setup / Teardown ────────────────────────────────────────────────

beforeAll(async () => {
  const env = getEnv()
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 })

  await seedOrgs(pool, [ORG_A as string, ORG_B as string])
  await seedProperties(pool)
  await seedReviews(pool)
})

beforeEach(async () => {
  await truncateInbox(pool)
})

afterAll(async () => {
  await truncateInbox(pool)
  await pool.end()
})

// ── Tests ───────────────────────────────────────────────────────────

describe('createInboxRepository', () => {
  const repo = createInboxRepository(db, stubPorts)

  it('returns an object satisfying InboxRepository', () => {
    expect(repo).toBeDefined()
    expect(typeof repo.findById).toBe('function')
    expect(typeof repo.create).toBe('function')
    expect(typeof repo.updateStatus).toBe('function')
  })
})

describe('inbox repository — CRUD', () => {
  const repo = createInboxRepository(db, stubPorts)

  it('creates and finds an inbox item by id', async () => {
    const item = makeInboxItem()
    await repo.create(item, ORG_A)

    const found = await repo.findById(item.id, ORG_A)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(item.id)
    expect(found!.status).toBe('open')
    // BQC-1.2: denormalized content columns are never written nor read back —
    // rating/snippet/reviewerName resolve live via the review lookup.
    expect(found!.rating).toBeNull()
    expect(found!.snippet).toBeNull()
    expect(found!.reviewerName).toBeNull()
  })

  it('findById returns null for non-existent id', async () => {
    const found = await repo.findById(inboxItemId(crypto.randomUUID()), ORG_A)
    expect(found).toBeNull()
  })

  it('findByIds returns multiple items', async () => {
    const item1 = makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) })
    const item2 = makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) })
    await repo.create(item1, ORG_A)
    await repo.create(item2, ORG_A)

    const found = await repo.findByIds([item1.id, item2.id], ORG_A)
    expect(found).toHaveLength(2)
  })

  it('findBySource finds item by source type + source id', async () => {
    const srcId = feedbackId(crypto.randomUUID())
    const item = makeInboxItem({ sourceType: 'feedback', sourceId: srcId })
    await repo.create(item, ORG_A)

    const found = await repo.findBySource('feedback', srcId as string, ORG_A)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(item.id)
  })

  it('findBySource returns null for wrong source type', async () => {
    const item = makeInboxItem({
      sourceType: 'review',
      sourceId: reviewId(crypto.randomUUID()),
    })
    await repo.create(item, ORG_A)
    const found = await repo.findBySource('feedback', item.sourceId as string, ORG_A)
    expect(found).toBeNull()
  })
})

describe('inbox repository — status transitions', () => {
  const repo = createInboxRepository(db, stubPorts)

  it('updates status from new to addressed', async () => {
    const item = makeInboxItem()
    await repo.create(item, ORG_A)

    const now = new Date()
    const updated = await repo.updateStatus(
      item.id,
      ORG_A,
      'closed',
      { closedAt: now },
      now,
    )
    expect(updated.status).toBe('closed')
    expect(updated.closedAt).toEqual(now)
  })

  it('updates status from new to escalated', async () => {
    const item = makeInboxItem()
    await repo.create(item, ORG_A)

    const now = new Date()
    const updated = await repo.updateStatus(
      item.id,
      ORG_A,
      'open',
      { escalatedAt: now },
      now,
    )
    expect(updated.status).toBe('open')
  })

  it('updates status from new to archived', async () => {
    const item = makeInboxItem()
    await repo.create(item, ORG_A)

    const now = new Date()
    const updated = await repo.updateStatus(
      item.id,
      ORG_A,
      'closed',
      { closedAt: now },
      now,
    )
    expect(updated.status).toBe('closed')
  })

  it('bulkUpdateStatus updates multiple items', async () => {
    const item1 = makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) })
    const item2 = makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) })
    await repo.create(item1, ORG_A)
    await repo.create(item2, ORG_A)

    const now = new Date()
    const result = await repo.bulkUpdateStatus(
      [item1.id, item2.id],
      ORG_A,
      'closed',
      { closedAt: now },
      now,
    )
    expect(result.updated).toBe(2)

    const found1 = await repo.findById(item1.id, ORG_A)
    expect(found1!.status).toBe('closed')
  })
})

describe('inbox repository — assignment', () => {
  const repo = createInboxRepository(db, stubPorts)

  it('assigns an item to a user', async () => {
    const item = makeInboxItem()
    await repo.create(item, ORG_A)

    const updated = await repo.updateAssignment(item.id, ORG_A, USER_A)
    expect(updated.assignedTo).toBe(USER_A)
  })

  it('unassigns an item', async () => {
    const item = makeInboxItem({ assignedTo: USER_A })
    await repo.create(item, ORG_A)

    const updated = await repo.updateAssignment(item.id, ORG_A, null)
    expect(updated.assignedTo).toBeNull()
  })
})

describe('inbox repository — count by status', () => {
  const repo = createInboxRepository(db, stubPorts)

  it('counts items by status', async () => {
    await repo.create(
      makeInboxItem({ sourceId: reviewId(crypto.randomUUID()), status: 'open' }),
      ORG_A,
    )
    await repo.create(
      makeInboxItem({ sourceId: reviewId(crypto.randomUUID()), status: 'open' }),
      ORG_A,
    )
    await repo.create(
      makeInboxItem({ sourceId: reviewId(crypto.randomUUID()), status: 'closed' }),
      ORG_A,
    )

    const newCount = await repo.countByStatus(ORG_A, 'open')
    expect(newCount).toBe(2)

    const addressedCount = await repo.countByStatus(ORG_A, 'closed')
    expect(addressedCount).toBe(1)
  })
})

describe('inbox repository — pagination', () => {
  const repo = createInboxRepository(db, stubPorts)

  it('returns paginated results with cursor', async () => {
    // Create 5 items with different source dates
    for (let i = 0; i < 5; i++) {
      const date = new Date(2026, 0, i + 1) // Jan 1-5, 2026
      await repo.create(
        makeInboxItem({
          sourceId: reviewId(crypto.randomUUID()),
          sourceDate: date,
        }),
        ORG_A,
      )
    }

    // Request first 3
    const result = await repo.findFilteredPaginated({}, ORG_A, undefined, 3)
    expect(result.items).toHaveLength(3)
    expect(result.totalCount).toBe(5)
    expect(result.nextCursor).not.toBeNull()

    // Request next page
    const page2 = await repo.findFilteredPaginated({}, ORG_A, result.nextCursor!, 3)
    expect(page2.items).toHaveLength(2)
    expect(page2.totalCount).toBe(5)
    expect(page2.nextCursor).toBeNull()
  })

  it('supports oldest-first keyset pagination', async () => {
    for (let i = 0; i < 3; i++) {
      await repo.create(
        makeInboxItem({
          sourceId: reviewId(crypto.randomUUID()),
          sourceDate: new Date(Date.UTC(2026, 0, i + 1)),
        }),
        ORG_A,
      )
    }

    const page1 = await repo.findFilteredPaginated(
      { sort: 'oldest' },
      ORG_A,
      undefined,
      2,
    )
    const page2 = await repo.findFilteredPaginated(
      { sort: 'oldest' },
      ORG_A,
      page1.nextCursor!,
      2,
    )

    expect(page1.items.map((item) => item.sourceDate.toISOString())).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
    ])
    expect(page2.items[0]!.sourceDate.toISOString()).toBe('2026-01-03T00:00:00.000Z')
    expect(page2.totalCount).toBe(3)
  })

  it.each([
    [
      'newest' as const,
      [
        '00000000-0000-4000-8000-000000000003',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000001',
      ],
    ],
    [
      'oldest' as const,
      [
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000003',
      ],
    ],
  ])('uses id as the %s tie-breaker across pages', async (sort, expectedIds) => {
    const sharedDate = new Date('2026-01-15T10:00:00.000Z')
    for (const id of expectedIds) {
      await repo.create(
        makeInboxItem({
          id: inboxItemId(id),
          sourceId: reviewId(crypto.randomUUID()),
          sourceDate: sharedDate,
        }),
        ORG_A,
      )
    }

    const page1 = await repo.findFilteredPaginated({ sort }, ORG_A, undefined, 2)
    const page2 = await repo.findFilteredPaginated({ sort }, ORG_A, page1.nextCursor!, 2)

    expect([...page1.items, ...page2.items].map((item) => item.id)).toEqual(
      expectedIds.map(inboxItemId),
    )
    expect(page2.totalCount).toBe(3)
  })

  it('filters by property', async () => {
    await repo.create(makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) }), ORG_A)
    await repo.create(
      makeInboxItem({
        sourceId: reviewId(crypto.randomUUID()),
        propertyId: propertyId('2a000000-0000-0000-0000-000000000099'),
      }),
      ORG_A,
    )

    const result = await repo.findFilteredPaginated(
      { propertyId: PROP_A },
      ORG_A,
      undefined,
      50,
    )
    expect(result.items).toHaveLength(1)
  })

  it('filters by status', async () => {
    await repo.create(
      makeInboxItem({ sourceId: reviewId(crypto.randomUUID()), status: 'open' }),
      ORG_A,
    )
    await repo.create(
      makeInboxItem({ sourceId: reviewId(crypto.randomUUID()), status: 'closed' }),
      ORG_A,
    )

    const result = await repo.findFilteredPaginated(
      { status: 'open' },
      ORG_A,
      undefined,
      50,
    )
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.status).toBe('open')
  })
})

describe('inbox repository — detail view', () => {
  const repo = createInboxRepository(db, stubPorts)

  it('findDetailById returns review source data for review items', async () => {
    const item = makeInboxItem({
      sourceType: 'review',
      sourceId: reviewId(crypto.randomUUID()),
    })
    await repo.create(item, ORG_A)

    const detail = await repo.findDetailById(item.id, ORG_A)
    expect(detail).not.toBeNull()
    expect(detail!.item.id).toBe(item.id)
    expect(detail!.item.sourceType).toBe('review')
    // BQC-1.2: the stub lookup reports not_found — typed status, no content.
    expect(detail!.reviewContentStatus).toBe('not_found')
    expect(detail!.reviewText).toBeNull()
    // BQC-1.2: an ineligible source may not leak a translation either.
    expect(detail!.reviewTranslatedText).toBeNull()
  })

  it('findDetailById surfaces the guest original and Google translation together', async () => {
    const srcId = crypto.randomUUID()
    const item = makeInboxItem({ sourceType: 'review', sourceId: reviewId(srcId) })
    await repo.create(item, ORG_A)

    const translatedRepo = createInboxRepository(db, {
      ...stubPorts,
      reviewLookup: {
        ...stubPorts.reviewLookup,
        getReviewSnippetById: async (): Promise<ReviewSnippetResult> => ({
          status: 'available',
          snippet: {
            reviewerName: 'Мария',
            text: 'Хотелът беше чист и уютен, а закуската беше много вкусна.',
            translatedText:
              'The hotel was clean and cosy, and the breakfast was very tasty.',
            reviewerProfilePhotoUrl: null,
            rating: 5,
            languageCode: 'bg',
          },
        }),
      },
    })

    const detail = await translatedRepo.findDetailById(item.id, ORG_A)
    expect(detail!.reviewContentStatus).toBe('available')
    expect(detail!.reviewText).toBe(
      'Хотелът беше чист и уютен, а закуската беше много вкусна.',
    )
    expect(detail!.reviewTranslatedText).toBe(
      'The hotel was clean and cosy, and the breakfast was very tasty.',
    )
  })

  it('findDetailById leaves the translation null for an untranslated review', async () => {
    const item = makeInboxItem({
      sourceType: 'review',
      sourceId: reviewId(crypto.randomUUID()),
    })
    await repo.create(item, ORG_A)

    const englishRepo = createInboxRepository(db, {
      ...stubPorts,
      reviewLookup: {
        ...stubPorts.reviewLookup,
        getReviewSnippetById: async (): Promise<ReviewSnippetResult> => ({
          status: 'available',
          snippet: {
            reviewerName: 'Jane',
            text: 'Wonderful stay.',
            translatedText: null,
            reviewerProfilePhotoUrl: null,
            rating: 5,
            languageCode: 'en',
          },
        }),
      },
    })

    const detail = await englishRepo.findDetailById(item.id, ORG_A)
    expect(detail!.reviewText).toBe('Wonderful stay.')
    expect(detail!.reviewTranslatedText).toBeNull()
  })

  it('findDetailById serves neither text nor translation for an expired review', async () => {
    const item = makeInboxItem({
      sourceType: 'review',
      sourceId: reviewId(crypto.randomUUID()),
    })
    await repo.create(item, ORG_A)

    const expiredRepo = createInboxRepository(db, {
      ...stubPorts,
      reviewLookup: {
        ...stubPorts.reviewLookup,
        getReviewSnippetById: async (): Promise<ReviewSnippetResult> => ({
          status: 'expired',
        }),
      },
    })

    const detail = await expiredRepo.findDetailById(item.id, ORG_A)
    expect(detail!.reviewContentStatus).toBe('expired')
    expect(detail!.reviewText).toBeNull()
    expect(detail!.reviewTranslatedText).toBeNull()
  })

  it('findDetailById returns null for non-existent item', async () => {
    const detail = await repo.findDetailById(inboxItemId(crypto.randomUUID()), ORG_A)
    expect(detail).toBeNull()
  })
})

describe('inbox repository — live content lookup (BQC-1.2)', () => {
  const repo = createInboxRepository(db, stubPorts)

  it('list items read rating/snippet/reviewerName from the eligible lookup map', async () => {
    const srcId = crypto.randomUUID()
    await repo.create(makeInboxItem({ sourceId: reviewId(srcId) }), ORG_A)

    const liveRepo = createInboxRepository(db, {
      ...stubPorts,
      reviewLookup: {
        ...stubPorts.reviewLookup,
        getReviewSnippetsByIds: async () =>
          new Map([
            [
              srcId,
              {
                text: 'Live text',
                translatedText: null,
                reviewerName: 'Live Reviewer',
                reviewerProfilePhotoUrl: null,
                rating: 5,
                languageCode: 'en',
              },
            ],
          ]),
      },
    })

    const result = await liveRepo.findFilteredPaginated({}, ORG_A, undefined, 50)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.rating).toBe(5)
    expect(result.items[0]!.snippet).toBe('Live text')
    expect(result.items[0]!.reviewerName).toBe('Live Reviewer')
    expect(result.items[0]!.reviewLanguageCode).toBe('en')
    expect(result.items[0]!.contentAvailability).toBe('text')
  })

  it('marks a live textless review as rating-only only when a rating exists', async () => {
    const sourceId = reviewId(crypto.randomUUID())
    await repo.create(makeInboxItem({ sourceId }), ORG_A)
    const ratingOnlyRepo = createInboxRepository(db, {
      ...stubPorts,
      reviewLookup: {
        ...stubPorts.reviewLookup,
        getReviewSnippetsByIds: async () =>
          new Map([
            [
              sourceId,
              {
                text: null,
                translatedText: null,
                reviewerName: null,
                reviewerProfilePhotoUrl: null,
                rating: 4,
                languageCode: null,
              },
            ],
          ]),
      },
    })

    const [item] = (await ratingOnlyRepo.findFilteredPaginated({}, ORG_A)).items
    expect(item?.snippet).toBeNull()
    expect(item?.contentAvailability).toBe('rating_only')
  })

  it('batches and enriches feedback rows without inventing a reviewer', async () => {
    const sourceId = feedbackId(crypto.randomUUID())
    await repo.create(
      makeInboxItem({ sourceType: 'feedback', sourceId, platform: 'direct' }),
      ORG_A,
    )
    const getFeedbackSnippetsByIds = vi.fn(
      async () =>
        new Map([[sourceId, { comment: 'Excellent breakfast', ratingValue: 5 }]]),
    )
    const feedbackRepo = createInboxRepository(db, {
      ...stubPorts,
      feedbackLookup: { ...stubPorts.feedbackLookup, getFeedbackSnippetsByIds },
    })

    const [item] = (await feedbackRepo.findFilteredPaginated({}, ORG_A)).items

    expect(getFeedbackSnippetsByIds).toHaveBeenCalledWith([sourceId], ORG_A)
    expect(item).toMatchObject({
      sourceType: 'feedback',
      rating: 5,
      snippet: 'Excellent breakfast',
      reviewerName: null,
      contentAvailability: 'text',
    })
  })

  it('enriches urgent attention only from a page-bounded current analysis', async () => {
    const urgentSourceId = reviewId(crypto.randomUUID())
    const otherSourceId = reviewId(crypto.randomUUID())
    await repo.create(makeInboxItem({ sourceId: urgentSourceId }), ORG_A)
    await repo.create(makeInboxItem({ sourceId: otherSourceId }), ORG_A)
    const findCurrentReviewIdsByAttention = vi.fn(async () => [urgentSourceId])
    const aiInsights: AiReviewInsightsPort = {
      readCurrentReviewAnalysis: vi.fn(async () => ({ status: 'disabled' as const })),
      findCurrentReviewIdsByAttention,
      findCurrentReviewIdsByCategory: vi.fn(async () => []),
    }
    const enrichedRepo = createInboxRepository(db, { ...stubPorts, aiInsights })

    const result = await enrichedRepo.findFilteredPaginated({}, ORG_A, undefined, 50)

    expect(findCurrentReviewIdsByAttention).toHaveBeenCalledWith({
      organizationId: ORG_A,
      propertyIds: [PROP_A],
      reviewIds: expect.arrayContaining([urgentSourceId, otherSourceId]),
      attention: ['urgent'],
    })
    expect(result.items.find((item) => item.sourceId === urgentSourceId)?.attention).toBe(
      'urgent',
    )
    expect(result.items.find((item) => item.sourceId === otherSourceId)?.attention).toBe(
      null,
    )
  })

  it('list items render nulls when the lookup has no eligible snippet', async () => {
    await repo.create(makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) }), ORG_A)

    const result = await repo.findFilteredPaginated({}, ORG_A, undefined, 50)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.rating).toBeNull()
    expect(result.items[0]!.snippet).toBeNull()
    expect(result.items[0]!.reviewerName).toBeNull()
    expect(result.items[0]!.contentAvailability).toBe('unavailable')
  })

  it('rating/search filters resolve via reviewLookup.findEligibleReviewIds', async () => {
    const srcMatch = crypto.randomUUID()
    const srcOther = crypto.randomUUID()
    await repo.create(makeInboxItem({ sourceId: reviewId(srcMatch) }), ORG_A)
    await repo.create(makeInboxItem({ sourceId: reviewId(srcOther) }), ORG_A)

    const filteredRepo = createInboxRepository(db, {
      ...stubPorts,
      reviewLookup: {
        ...stubPorts.reviewLookup,
        findEligibleReviewIds: async () => [srcMatch],
      },
    })

    const result = await filteredRepo.findFilteredPaginated(
      { ratingMin: 4 },
      ORG_A,
      undefined,
      50,
    )
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.sourceId).toBe(reviewId(srcMatch))
  })

  it('rating/search filters correlate eligible ids with feedback source type', async () => {
    const sharedId = crypto.randomUUID()
    await repo.create(
      makeInboxItem({ sourceType: 'review', sourceId: reviewId(sharedId) }),
      ORG_A,
    )
    await repo.create(
      makeInboxItem({ sourceType: 'feedback', sourceId: feedbackId(sharedId) }),
      ORG_A,
    )
    const findEligibleFeedbackIds = vi.fn(async () => [feedbackId(sharedId)])
    const filteredRepo = createInboxRepository(db, {
      ...stubPorts,
      feedbackLookup: { ...stubPorts.feedbackLookup, findEligibleFeedbackIds },
    })

    const result = await filteredRepo.findFilteredPaginated(
      { q: 'breakfast' },
      ORG_A,
      undefined,
      50,
    )

    expect(findEligibleFeedbackIds).toHaveBeenCalledWith(ORG_A, {
      ratingMin: undefined,
      ratingMax: undefined,
      textQuery: 'breakfast',
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.sourceType).toBe('feedback')
  })

  it('attention filters resolve through the tenant and property-scoped AI projection', async () => {
    const srcMatch = reviewId(crypto.randomUUID())
    const srcOther = reviewId(crypto.randomUUID())
    await repo.create(makeInboxItem({ sourceId: srcMatch }), ORG_A)
    await repo.create(makeInboxItem({ sourceId: srcOther }), ORG_A)
    const findCurrentReviewIdsByAttention = vi.fn(async () => [srcMatch])
    const aiInsights: AiReviewInsightsPort = {
      readCurrentReviewAnalysis: vi.fn(async () => ({ status: 'disabled' as const })),
      findCurrentReviewIdsByAttention,
      findCurrentReviewIdsByCategory: vi.fn(async () => []),
    }
    const filteredRepo = createInboxRepository(db, { ...stubPorts, aiInsights })

    const result = await filteredRepo.findFilteredPaginated(
      { propertyId: PROP_A, attention: ['urgent', 'high'] },
      ORG_A,
      undefined,
      50,
    )

    expect(findCurrentReviewIdsByAttention).toHaveBeenCalledWith({
      organizationId: ORG_A,
      propertyIds: [PROP_A],
      attention: ['urgent', 'high'],
    })
    expect(result.items.map((item) => item.sourceId)).toEqual([srcMatch])
  })

  it('category filters intersect with attention through the AI projection', async () => {
    const srcBoth = reviewId(crypto.randomUUID())
    const srcAttentionOnly = reviewId(crypto.randomUUID())
    const srcCategoryOnly = reviewId(crypto.randomUUID())
    for (const sourceId of [srcBoth, srcAttentionOnly, srcCategoryOnly]) {
      await repo.create(makeInboxItem({ sourceId }), ORG_A)
    }
    const findCurrentReviewIdsByCategory = vi.fn(async () => [srcBoth, srcCategoryOnly])
    const aiInsights: AiReviewInsightsPort = {
      readCurrentReviewAnalysis: vi.fn(async () => ({ status: 'disabled' as const })),
      findCurrentReviewIdsByAttention: vi.fn(async () => [srcBoth, srcAttentionOnly]),
      findCurrentReviewIdsByCategory,
    }
    const filteredRepo = createInboxRepository(db, { ...stubPorts, aiInsights })

    const result = await filteredRepo.findFilteredPaginated(
      { propertyId: PROP_A, attention: ['urgent'], category: ['wait_time'] },
      ORG_A,
      undefined,
      50,
    )

    expect(findCurrentReviewIdsByCategory).toHaveBeenCalledWith({
      organizationId: ORG_A,
      propertyIds: [PROP_A],
      categories: ['wait_time'],
    })
    // Intersection, not union: only the review in BOTH id sets survives.
    expect(result.items.map((item) => item.sourceId)).toEqual([srcBoth])
  })

  it('an empty AI id set means no matches, never no filter', async () => {
    // The dangerous failure mode: a tenant without the AI capability, or a
    // category nobody has mentioned, resolves to zero review ids. Skipping the
    // predicate then would show the ENTIRE inbox while the UI claims a filter
    // is applied -- the same class of defect as a search param that gets
    // stripped before it reaches the query.
    await repo.create(makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) }), ORG_A)
    await repo.create(makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) }), ORG_A)
    const aiInsights: AiReviewInsightsPort = {
      readCurrentReviewAnalysis: vi.fn(async () => ({ status: 'disabled' as const })),
      findCurrentReviewIdsByAttention: vi.fn(async () => []),
      findCurrentReviewIdsByCategory: vi.fn(async () => []),
    }
    const filteredRepo = createInboxRepository(db, { ...stubPorts, aiInsights })

    for (const filters of [
      { propertyId: PROP_A, category: ['service' as const] },
      { propertyId: PROP_A, attention: ['urgent' as const] },
    ]) {
      const result = await filteredRepo.findFilteredPaginated(
        filters,
        ORG_A,
        undefined,
        50,
      )
      expect(result.items).toHaveLength(0)
      expect(result.nextCursor).toBeNull()
    }
  })

  it('rating/search filters match nothing when no reviews are eligible', async () => {
    await repo.create(makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) }), ORG_A)

    // stubPorts.findEligibleReviewIds returns [] — provably empty result.
    const result = await repo.findFilteredPaginated(
      { ratingMin: 4 },
      ORG_A,
      undefined,
      50,
    )
    expect(result.items).toHaveLength(0)
    expect(result.nextCursor).toBeNull()
  })
})

// ── Tenant isolation ────────────────────────────────────────────────

describe('inbox repository — tenant isolation', () => {
  const repo = createInboxRepository(db, stubPorts)

  it('findById returns null for different org', async () => {
    const item = makeInboxItem()
    await repo.create(item, ORG_A)

    // ORG_B should not see ORG_A's item
    const found = await repo.findById(item.id, ORG_B)
    expect(found).toBeNull()
  })

  it('findBySource returns null for different org', async () => {
    const item = makeInboxItem({
      sourceType: 'review',
      sourceId: reviewId(crypto.randomUUID()),
    })
    await repo.create(item, ORG_A)

    const found = await repo.findBySource('review', item.sourceId as string, ORG_B)
    expect(found).toBeNull()
  })

  it('findFilteredPaginated returns empty for different org', async () => {
    await repo.create(makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) }), ORG_A)

    const result = await repo.findFilteredPaginated({}, ORG_B, undefined, 50)
    expect(result.items).toHaveLength(0)
    expect(result.totalCount).toBe(0)
  })

  it('updateStatus does not affect different org items', async () => {
    const item = makeInboxItem()
    await repo.create(item, ORG_A)

    // ORG_B tries to update ORG_A's item — should throw not_found
    await expect(
      repo.updateStatus(item.id, ORG_B, 'closed', { closedAt: new Date() }),
    ).rejects.toMatchObject({ _tag: 'InboxError', code: 'not_found' })
  })

  it('countByStatus returns 0 for different org', async () => {
    await repo.create(
      makeInboxItem({ sourceId: reviewId(crypto.randomUUID()), status: 'open' }),
      ORG_A,
    )

    const count = await repo.countByStatus(ORG_B, 'open')
    expect(count).toBe(0)
  })

  it('create rejects tenant mismatch', async () => {
    const item = makeInboxItem({ organizationId: ORG_A })
    await expect(repo.create(item, ORG_B)).rejects.toMatchObject({
      _tag: 'InboxError',
      code: 'forbidden',
    })
  })
})
