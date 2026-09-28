// A Google disconnect cancels only publication cycles that were never
// dispatched. Once the worker has claimed a cycle (sending) or Google has
// accepted the write (pending_observation), the reply may already be live, so
// "returned to draft — approve it again" would be false and could send it
// twice. Those cycles stay with the worker and the reconciliation sweep,
// which end them with the accurate "not confirmed on Google" notice. Runs a
// real authorize → claim → provider outcome so the states are the production
// ones.

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  organizationId,
  propertyId,
  reviewId,
  replyId,
  userId,
} from '#/shared/domain/ids'
import type { Reply, Review } from '../domain/types'
import { reviewReplyPublicationRequested } from '../domain/events'
import { createReviewRepository } from './repositories/review.repository'
import { createReplyRepository } from './repositories/reply.repository'
import { createAtomicReplyCommandStore } from './reply-command-store'

const ORG_A = organizationId('org-disconnect-scope-eeee-5555555555')
const PROP_A = propertyId('3f000000-0000-0000-0000-000000000001')
const REVIEW_A = reviewId('3f000000-0000-0000-0000-000000000010')
const REPLY_A = replyId('3f000000-0000-0000-0000-000000000020')
const USER_A = userId('user-disconnect-scope-eeee-555555')
const NOW = new Date('2026-09-28T10:00:00.000Z')

let pool: Pool

async function seedOrgAndProperty(p: Pool) {
  const slug = 't-' + ORG_A.replace(/-/g, '').slice(-12)
  const conflicting = await p.query<{ id: string }>(
    `SELECT id FROM organization WHERE slug = $1 AND id <> $2`,
    [slug, ORG_A],
  )
  await deleteTestOrganizations(
    p,
    conflicting.rows.map(({ id }) => id),
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
    [PROP_A, ORG_A, 'Disconnect Scope Property', 'disconnect-scope-prop', 'UTC'],
  )
}

async function clearTenant(p: Pool) {
  for (const table of [
    'authorization_execution_permits',
    'google_reply_observation_heads',
    'google_reply_observations',
    'reply_publication_attempts',
    'reply_publication_authorizations',
    'outbox_events',
    'replies',
    'reviews',
  ]) {
    await p.query(`DELETE FROM ${table} WHERE organization_id = $1`, [ORG_A])
  }
}

const review = (): Review => ({
  id: REVIEW_A,
  organizationId: ORG_A,
  propertyId: PROP_A,
  platform: 'google',
  externalId: 'ext-disconnect-scope-1',
  externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  googleConnectionId: null,
  reviewerName: 'Jane Doe',
  reviewerProfilePhotoUrl: null,
  rating: 5,
  text: 'Great place!',
  translatedText: null,
  languageCode: 'en',
  reviewedAt: NOW,
  expiresAt: new Date(NOW.getTime() + 25 * 86_400_000),
  sentimentLabel: null,
  sentimentScore: null,
  sourceCreatedAt: NOW,
  sourceUpdatedAt: null,
  firstFetchedAt: NOW,
  lastFetchedAt: NOW,
  contentExpiresAt: new Date(NOW.getTime() + 25 * 86_400_000),
  contentHash: null,
  sourceSeenGeneration: null,
  sourceEpoch: 0,
  sourceRevision: 0,
  analysisSequence: 0,
  aiSourceByteLength: 1,
  aiSourceDigest: '0'.repeat(64),
  createdAt: NOW,
  updatedAt: NOW,
})

const pendingReply = (): Reply => ({
  id: REPLY_A,
  reviewId: REVIEW_A,
  organizationId: ORG_A,
  text: 'Thank you for staying with us.',
  status: 'pending_approval',
  source: 'internal',
  createdBy: USER_A,
  approvedBy: null,
  rejectedBy: null,
  rejectionReason: null,
  aiGenerated: false,
  templateId: null,
  templateVersion: null,
  stateRevision: 1,
  submittedAt: NOW,
  approvedAt: null,
  publishedAt: null,
  publicationState: null,
  publicationCycle: 0,
  publicationAttempts: 0,
  publicationLastErrorClass: null,
  reconcileDueAt: null,
  createdAt: NOW,
  updatedAt: NOW,
})

/** Drives the reply to `stage` through the production commands. */
async function replyAt(stage: 'authorized' | 'sending' | 'pending_observation') {
  const db = getDb()
  const reviewRepo = createReviewRepository(db, () => NOW)
  const replyRepo = createReplyRepository(db, () => NOW)
  const store = createAtomicReplyCommandStore(
    db,
    () => NOW,
    async () => true,
  )
  const saved = await reviewRepo.upsert(review())
  const authorized = await store.markPublicationAuthorized(
    await replyRepo.upsert(pendingReply()),
    { status: 'approved', approvedBy: USER_A, approvedAt: NOW },
    {
      lifecycleEvent: null,
      publicationIntent: reviewReplyPublicationRequested({
        replyId: REPLY_A,
        reviewId: REVIEW_A,
        propertyId: PROP_A,
        organizationId: ORG_A,
        userId: USER_A,
        publicationCycle: 1,
        sourceEpoch: saved.sourceEpoch,
        materialReviewRevision: saved.sourceRevision,
        baseObservationRevision: 0,
        occurredAt: NOW,
      }),
    },
    NOW,
  )
  let reply = authorized!
  if (stage !== 'authorized') {
    reply = (await store.markPublicationSending(
      reply,
      {
        providerOperationKey: `publish:${REPLY_A}:1:1`,
        propertyId: PROP_A,
        sourceEpoch: saved.sourceEpoch,
        materialReviewRevision: saved.sourceRevision,
        baseObservationRevision: 0,
      },
      NOW,
    ))!
  }
  if (stage === 'pending_observation') {
    reply = (await store.markProviderOutcomePendingObservation(
      reply,
      { providerCorrelationId: 'provider-correlation-1', providerRespondedAt: NOW },
      NOW,
    ))!
  }
  expect(reply.publicationState).toBe(stage)
  return replyRepo
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  await clearTenant(pool)
  clearEventSchemas()
  await pool.end()
})

beforeEach(async () => {
  await clearTenant(pool)
  await seedOrgAndProperty(pool)
})

describe('replies a Google disconnect may cancel', () => {
  it('includes a cycle that was authorized but never dispatched', async () => {
    const replyRepo = await replyAt('authorized')

    const found = await replyRepo.findUndispatchedPublicationsByReviewIds(
      [REVIEW_A],
      ORG_A,
    )

    expect(found.map((r) => r.id)).toEqual([REPLY_A])
  })

  it.each(['sending', 'pending_observation'] as const)(
    'leaves a %s cycle, which may already be on Google, to the sweep',
    async (stage) => {
      const replyRepo = await replyAt(stage)

      const found = await replyRepo.findUndispatchedPublicationsByReviewIds(
        [REVIEW_A],
        ORG_A,
      )

      expect(found).toEqual([])
    },
  )
})
