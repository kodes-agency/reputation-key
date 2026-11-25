import { randomUUID as freshUuid } from 'node:crypto'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/shared/testing/google-provider-identifiers-v1'
import { recordOutboxFact } from '#/shared/testing/outbox-fact-fixture'
import { beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import type { DomainEvent } from '#/shared/events/events'
import {
  inboxItemId,
  feedbackId,
  organizationId,
  portalId,
  propertyId,
  reviewId,
  replyId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '#/contexts/reputation/domain/inbox-types'
import type { Reply, Review } from '#/contexts/reputation/domain/review-types'
import { inboxItemCreated } from '#/contexts/reputation/domain/inbox-events'
import {
  createAtomicInboxCommandStore as createProductionInboxCommandStore,
  type InboxCommandAuthority,
} from '#/contexts/reputation/inbox/command-store.server'
import type {
  ReviewLookupPort,
  ReviewSnippetResult,
} from '#/contexts/reputation/inbox/review-lookup.port.server'
import type { FeedbackLookupPort } from '#/contexts/reputation/inbox/feedback-lookup.port.server'
import type { PropertyLookupPort } from '#/contexts/reputation/inbox/property-lookup.port.server'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { testReviewRepository } from '#/contexts/reputation/reviews/review-stores.test-fixtures'

export const ORG_A = organizationId('org-inbox-cmd-aaaa-1111111111111111')
export const ORG_B = organizationId('org-inbox-cmd-bbbb-2222222222222222')
export const PROP_A = propertyId('4d000000-0000-0000-0000-000000000001')
export const PROP_B = propertyId('4d000000-0000-0000-0000-000000000002')
export const PROP_C = propertyId('4d000000-0000-0000-0000-000000000003')
export const USER_A = userId('user-inbox-cmd-aaaa-1111111111')
export const USER_B = userId('user-inbox-cmd-bbbb-2222222222')
export const REVIEW_A = reviewId('4d000000-0000-0000-0000-000000000010')
export const ITEM_A = inboxItemId('4d000000-0000-0000-0000-000000000020')
export const ITEM_B = inboxItemId('4d000000-0000-0000-0000-000000000021')
export const FEEDBACK_A = feedbackId('4d000000-0000-0000-0000-000000000030')
export const FEEDBACK_B = feedbackId('4d000000-0000-0000-0000-000000000031')
export const PORTAL_A = portalId('4d000000-0000-0000-0000-000000000040')
export const NOW = new Date('2026-06-01T12:00:00.000Z')
export const CONSUMER = 'inbox.on-review-created'

export const allowAllCommandAuthority: InboxCommandAuthority = async () => ({
  allowed: true,
})

export const createAtomicInboxCommandStore = (db: Database) =>
  createProductionInboxCommandStore(db, allowAllCommandAuthority, () => NOW)

export let pool: Pool
export const db = getDb()

export const noopLogger: LoggerPort = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
}

export const repositoryRuntime = { clock: () => NOW, logger: noopLogger }

// Stub enrichment ports — inbox repo owns the SQL, these just answer lookups.
export const stubPorts = {
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

export function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
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
    commandRevision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: REVIEW_A,
    organizationId: ORG_A,
    propertyId: PROP_A,
    platform: 'google',
    externalId: `ext-${freshUuid()}`,
    externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    googleConnectionId: null,
    reviewerName: 'Jane Doe',
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: 5,
    text: 'Great place!',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: NOW,
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: NOW,
    sourceUpdatedAt: null,
    firstFetchedAt: NOW,
    lastFetchedAt: NOW,
    contentExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
    contentHash: null,
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 0,
    analysisSequence: 0,
    aiSourceByteLength: 1,
    aiSourceDigest: '0'.repeat(64),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function makeReply(overrides: Partial<Reply> = {}): Reply {
  return {
    id: replyId(freshUuid()),
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
    stateRevision: 1,
    submittedAt: new Date('2026-05-28T10:00:00.000Z'),
    approvedAt: new Date('2026-05-28T11:00:00.000Z'),
    publishedAt: new Date('2026-05-29T10:00:00.000Z'),
    publicationState: 'published',
    publicationAttempts: 0,
    publicationCycle: 1,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export async function seedOrgAndProperty(p: Pool) {
  const slug = 't-' + ORG_A.replace(/-/g, '').slice(-12)
  const conflictingOrganizations = await p.query<{ id: string }>(
    `SELECT id FROM organization WHERE slug = $1 AND id <> $2`,
    [slug, ORG_A],
  )
  await deleteTestOrganizations(
    p,
    conflictingOrganizations.rows.map(({ id }) => id),
  )
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

export async function truncateAll(p: Pool) {
  await p.query('DELETE FROM inbox_notes WHERE organization_id = $1', [ORG_A])
  await p.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG_A])
  for (const table of ['replies', 'reviews'])
    await p.query(`DELETE FROM ${table} WHERE organization_id = $1`, [ORG_A])
  // Receipts cascade from outbox_events.
  await p.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG_A])
}

/** Insert the delivered source event row (receipts FK to outbox_events.id). */
export async function insertSourceEvent(event: DomainEvent): Promise<void> {
  await recordOutboxFact(db, event)
}

export async function seedReviewRevisionOne(): Promise<void> {
  await testReviewRepository(db).upsert(
    makeReview({ sourceRevision: 1, analysisSequence: 1 }),
    NOW,
    'f'.repeat(64),
  )
}

export async function restoreReviewSourceContentConstraint(): Promise<void> {
  await pool.query(
    `UPDATE inbox_items
     SET rating = NULL, snippet = NULL, reviewer_name = NULL
     WHERE source_type = 'review'
       AND (rating IS NOT NULL OR snippet IS NOT NULL OR reviewer_name IS NOT NULL)`,
  )
  await pool.query(
    'ALTER TABLE inbox_items DROP CONSTRAINT IF EXISTS inbox_items_review_source_content_free',
  )
  await pool.query(
    `ALTER TABLE inbox_items
     ADD CONSTRAINT inbox_items_review_source_content_free
     CHECK (
       source_type <> 'review'
       OR (rating IS NULL AND snippet IS NULL AND reviewer_name IS NULL)
     ) NOT VALID`,
  )
  await pool.query(
    'ALTER TABLE inbox_items VALIDATE CONSTRAINT inbox_items_review_source_content_free',
  )
}

export const createdFact = (item: InboxItem) =>
  inboxItemCreated({
    inboxItemId: item.id,
    organizationId: item.organizationId,
    propertyId: item.propertyId,
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    occurredAt: item.createdAt,
  })

export function useInboxCommandStoreDb(): void {
  beforeAll(async () => {
    const env = getEnv()
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 })
    const client = await pool.connect()
    client.release()
  })

  afterAll(async () => {
    await truncateAll(pool)
    await pool.end()
  })

  beforeEach(async () => {
    await truncateAll(pool)
    await seedOrgAndProperty(pool)
  })
}
