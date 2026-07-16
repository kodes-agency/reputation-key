// Inbox context — inbox repository integration tests
// Per architecture: integration tests against real Postgres.
// Tenant isolation test is NON-NEGOTIABLE.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { createInboxRepository } from './inbox.repository'
import type { ReviewLookupPort } from '../../application/ports/review-lookup.port'
import type { FeedbackLookupPort } from '../../application/ports/feedback-lookup.port'
import type { PropertyLookupPort } from '../../application/ports/property-lookup.port'
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
    getReviewSnippetById: async () => null,
    getReviewSnippetsByIds: async () => new Map(),
  } satisfies ReviewLookupPort,
  feedbackLookup: {
    getFeedbackSnippetById: async () => null,
  } satisfies FeedbackLookupPort,
  propertyLookup: {
    getPropertyNameById: async () => null,
    getPropertyNamesByIds: async () => new Map(),
  } satisfies PropertyLookupPort,
}

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
    `INSERT INTO reviews (id, organization_id, property_id, external_id, external_location_id, platform, rating, text, reviewer_name, reviewed_at, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'ext-rev-001', 'ext-loc-001', 'google', 4, 'Great service', 'John Doe', NOW(), NOW() + INTERVAL '1 year', NOW(), NOW())
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
    expect(found!.rating).toBe(4)
    expect(found!.reviewerName).toBe('John Doe')
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
    expect(result.nextCursor).not.toBeNull()

    // Request next page
    const page2 = await repo.findFilteredPaginated({}, ORG_A, result.nextCursor!, 3)
    expect(page2.items).toHaveLength(2)
    expect(page2.nextCursor).toBeNull()
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
  })

  it('findDetailById returns null for non-existent item', async () => {
    const detail = await repo.findDetailById(inboxItemId(crypto.randomUUID()), ORG_A)
    expect(detail).toBeNull()
  })
})

describe('inbox repository — denormalized field sync', () => {
  const repo = createInboxRepository(db, stubPorts)

  it('syncDenormalizedFields updates rating and snippet', async () => {
    const item = makeInboxItem({ rating: 3, snippet: 'Old text' })
    await repo.create(item, ORG_A)

    await repo.syncDenormalizedFields(item.id, ORG_A, {
      rating: 5,
      snippet: 'Updated text',
      reviewerName: 'Jane Smith',
    })

    const found = await repo.findById(item.id, ORG_A)
    expect(found!.rating).toBe(5)
    expect(found!.snippet).toBe('Updated text')
    expect(found!.reviewerName).toBe('Jane Smith')
  })

  it('syncDenormalizedFields clears snippet and reviewerName when set to null (BQR-3.3)', async () => {
    const item = makeInboxItem({
      rating: 4,
      snippet: 'Raw review text',
      reviewerName: 'John Doe',
    })
    await repo.create(item, ORG_A)

    await repo.syncDenormalizedFields(item.id, ORG_A, {
      snippet: null,
      reviewerName: null,
    })

    const found = await repo.findById(item.id, ORG_A)
    expect(found!.snippet).toBeNull()
    expect(found!.reviewerName).toBeNull()
    expect(found!.rating).toBe(4)
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
  })

  it('updateStatus does not affect different org items', async () => {
    const item = makeInboxItem()
    await repo.create(item, ORG_A)

    // ORG_B tries to update ORG_A's item — should throw not_found
    await expect(
      repo.updateStatus(item.id, ORG_B, 'closed', { closedAt: new Date() }),
    ).rejects.toThrow()
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
    await expect(repo.create(item, ORG_B)).rejects.toThrow()
  })
})
