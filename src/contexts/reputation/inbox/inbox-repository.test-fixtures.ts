import { reviewOpeningAnchor } from './review-opening-anchor.test-fixtures'
import { allowAllCommandAuthority } from '#/contexts/reputation/inbox/inbox-test-doubles.test-fixtures'
import { randomUUID as freshUuid } from 'node:crypto'
import { beforeAll, beforeEach, afterAll } from 'vitest'
import { createInboxRepository as createProductionInboxRepository } from './inbox-repository.server'
import type { ReviewLookupPort } from '#/contexts/reputation/inbox/review-lookup.port.server'
import type { FeedbackLookupPort } from '#/contexts/reputation/inbox/feedback-lookup.port.server'
import type { PropertyLookupPort } from '#/contexts/reputation/inbox/property-lookup.port.server'
import type { AiReviewInsightsPort } from '#/contexts/reputation/inbox/ai-review-insights.port.server'
import { getDb } from '#/shared/db'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '#/contexts/reputation/domain/inbox-types'
import type { Database } from '#/shared/db'
import { createAtomicInboxCommandStore } from '#/contexts/reputation/inbox/command-store.server'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'

export const ORG_A = organizationId('org-inbox-test-aaaa-1111111111111111')
export const ORG_B = organizationId('org-inbox-test-bbbb-2222222222222222')
export const PROP_A = propertyId('1a000000-0000-0000-0000-000000000001')
export const PROP_A_2 = propertyId('1a000000-0000-0000-0000-000000000002')
export const PROP_B = propertyId('1b000000-0000-0000-0000-000000000002')
export const USER_A = userId('user-inbox-test-aaaa-1111111111111111')
export const REVIEW_ID_A = '11111111-1111-1111-1111-111111111111'
export const TEST_NOW = new Date('2026-06-01T12:00:00.000Z')

export let pool: Pool
export const db = getDb()

export type RepositoryPorts = Readonly<{
  reviewLookup: ReviewLookupPort
  feedbackLookup: FeedbackLookupPort
  propertyLookup: PropertyLookupPort
  aiInsights?: AiReviewInsightsPort
}>

/**
 * Actionable fixtures enter through the same atomic item + initial Handling
 * Cycle path as production. Orphan/repair fixtures omit the initial anchor.
 */
export function createInboxRepository(database: Database, ports: RepositoryPorts) {
  const repository = createProductionInboxRepository(database, ports)
  return {
    ...repository,
    seedItem: async (item: InboxItem) => {
      if (item.sourceType === 'feedback') {
        return (
          await createAtomicInboxCommandStore(
            database,
            allowAllCommandAuthority,
          ).createItem(item, {
            sourceRevision: 1,
            openedReason: 'feedback_submitted',
            actorType: 'guest',
            triggerEventId: null,
            openedAt: item.createdAt,
          })
        ).item
      }

      await pool.query(
        `WITH identity AS (
           INSERT INTO reviews (
             id, organization_id, property_id, platform, external_id,
             external_location_id, expires_at, first_fetched_at,
             source_epoch, source_revision, source_observation_sequence,
             analysis_sequence, source_content_state, created_at, updated_at
           ) VALUES (
             $1, $2, $3, 'google', $4, 'locations/inbox-repository-test',
             $5::timestamptz + INTERVAL '1 year', $5::timestamptz,
             0, 1, 0, 1, 'active', $5::timestamptz, $5::timestamptz
           ) ON CONFLICT (id) DO NOTHING
           RETURNING id
         ) INSERT INTO review_source_contents (
           review_id, organization_id, property_id, platform, external_id,
           external_location_id, rating, reviewed_at, content_expires_at,
           first_fetched_at, last_fetched_at, source_epoch, source_revision,
           ai_source_byte_length, ai_source_digest
         ) SELECT id, $2, $3, 'google', $4, 'locations/inbox-repository-test',
           4, $5::timestamptz, $5::timestamptz + INTERVAL '1 year',
           $5::timestamptz, $5::timestamptz, 0, 1, 1, repeat('a', 64)
           FROM identity`,
        [
          item.sourceId,
          item.organizationId,
          item.propertyId,
          `repository-fixture-${item.sourceId}`,
          item.sourceDate,
        ],
      )
      await pool.query(
        `INSERT INTO material_review_revisions (
           review_id, revision, organization_id, property_id, source_epoch,
           normalization_version, source_digest, normalized_digest, rating,
           normalized_text, content_state, created_at, updated_at
         ) VALUES (
           $1, 1, $2, $3, 0, 'review-material-v1', repeat('b', 64),
           repeat('b', 64), 4, 'fixture', 'active', $4, $4
         ) ON CONFLICT (review_id, revision) DO NOTHING`,
        [item.sourceId, item.organizationId, item.propertyId, item.sourceDate],
      )
      return (
        await createAtomicInboxCommandStore(
          database,
          allowAllCommandAuthority,
        ).createItem(item, reviewOpeningAnchor(item))
      ).item
    },
  }
}

export type AttentionLookup = Parameters<
  AiReviewInsightsPort['findCurrentReviewIdsByAttention']
>[0]

/** A level a manager set, written as the command store writes it. */
export async function setManagerPriority(
  id: InboxItem['id'],
  level: 'urgent' | 'high' | 'medium' | 'low',
): Promise<void> {
  await pool.query(
    `UPDATE inbox_items
        SET manager_priority = $2, manager_priority_set_by = $3,
            manager_priority_set_at = $4, command_revision = command_revision + 1
      WHERE id = $1`,
    [id, level, USER_A, TEST_NOW],
  )
}

// ── Helpers ──────────────────────────────────────────────────────────

export function makeInboxItem(overrides: Partial<InboxItem> = {}): InboxItem {
  const now = new Date(performance.timeOrigin + performance.now())
  return {
    id: inboxItemId(freshUuid()),
    organizationId: ORG_A,
    propertyId: PROP_A,
    sourceType: 'review',
    sourceId: reviewId(freshUuid()),
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
    commandRevision: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function truncateInbox(pool: Pool) {
  await pool.query('DELETE FROM inbox_items WHERE organization_id IN ($1, $2)', [
    ORG_A as string,
    ORG_B as string,
  ])
  await pool.query('DELETE FROM reviews WHERE organization_id IN ($1, $2) AND id <> $3', [
    ORG_A as string,
    ORG_B as string,
    REVIEW_ID_A,
  ])
}

export async function seedOrgs(pool: Pool, ids: string[]) {
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

export async function seedProperties(pool: Pool) {
  const props = [
    { id: PROP_A as string, org: ORG_A as string, slug: 'inbox-test-prop-a' },
    { id: PROP_A_2 as string, org: ORG_A as string, slug: 'inbox-test-prop-a-2' },
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

export async function seedReviews(pool: Pool) {
  await pool.query(
    `WITH identity AS (
       INSERT INTO reviews (
         id, organization_id, property_id, external_id, external_location_id,
         platform, expires_at, first_fetched_at,
         source_epoch, source_revision, analysis_sequence, created_at, updated_at
       ) VALUES (
         $1, $2, $3, 'ext-rev-001', 'ext-loc-001',
         'google', NOW() + INTERVAL '1 year', NOW(),
         0, 0, 0, NOW(), NOW()
       )
       ON CONFLICT (platform, external_id, organization_id) DO NOTHING
       RETURNING id
     ) INSERT INTO review_source_contents (
       review_id, organization_id, property_id, platform, external_id,
       external_location_id, rating, text, reviewer_name, reviewed_at,
       content_expires_at, first_fetched_at, last_fetched_at,
       source_epoch, source_revision, ai_source_byte_length, ai_source_digest
     ) SELECT id, $2, $3, 'google', 'ext-rev-001', 'ext-loc-001',
       4, 'Great service', 'John Doe', NOW(), NOW() + INTERVAL '1 year',
       NOW(), NOW(), 0, 0, 1, repeat('0', 64) FROM identity`,
    [REVIEW_ID_A, ORG_A as string, PROP_A as string],
  )
}

export function useInboxRepositoryDb(): void {
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
}
