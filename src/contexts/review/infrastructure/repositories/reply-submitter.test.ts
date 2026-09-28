// Who submitted a reply, stored with it (real PostgreSQL).
//
// A reply's decision and publication facts are addressed to whoever put it up
// for approval. The submit write records that person beside the creator, and
// the reply read back carries both.

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  organizationId,
  propertyId,
  replyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { Reply, Review } from '../../domain/types'
import { reviewReplySubmitted } from '../../domain/events'
import { replyAuthor } from '../../domain/reply-author'
import { createReviewRepository } from './review.repository'
import { createReplyRepository } from './reply.repository'
import { createAtomicReplyCommandStore } from '../reply-command-store'

const ORG = organizationId('org-reply-submitter-1111111111111111')
const PROPERTY = propertyId('2c000000-0000-0000-0000-000000000001')
const REVIEW = reviewId('2c000000-0000-0000-0000-000000000010')
const REPLY = replyId('2c000000-0000-0000-0000-000000000020')
const CREATOR = userId('user-reply-submitter-creator')
const SUBMITTER = userId('user-reply-submitter-submitter')
const NOW = new Date('2026-09-20T12:00:00.000Z')

let pool: Pool

const review: Review = {
  id: REVIEW,
  organizationId: ORG,
  propertyId: PROPERTY,
  platform: 'google',
  externalId: 'ext-reply-submitter-1',
  externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  googleConnectionId: null,
  reviewerName: 'Jane Doe',
  reviewerProfilePhotoUrl: null,
  rating: 5,
  text: 'Great place!',
  translatedText: null,
  languageCode: 'en',
  reviewedAt: NOW,
  expiresAt: new Date(NOW.getTime() + 25 * 24 * 60 * 60 * 1000),
  sentimentLabel: null,
  sentimentScore: null,
  sourceCreatedAt: NOW,
  sourceUpdatedAt: null,
  firstFetchedAt: NOW,
  lastFetchedAt: NOW,
  contentExpiresAt: new Date(NOW.getTime() + 25 * 24 * 60 * 60 * 1000),
  contentHash: null,
  sourceSeenGeneration: null,
  sourceEpoch: 0,
  sourceRevision: 0,
  analysisSequence: 0,
  aiSourceByteLength: 1,
  aiSourceDigest: '0'.repeat(64),
  createdAt: NOW,
  updatedAt: NOW,
}

const draft: Reply = {
  id: REPLY,
  reviewId: REVIEW,
  organizationId: ORG,
  text: 'Thank you for the kind words!',
  templateId: null,
  templateVersion: null,
  status: 'draft',
  source: 'internal',
  createdBy: CREATOR,
  approvedBy: null,
  rejectedBy: null,
  rejectionReason: null,
  aiGenerated: false,
  stateRevision: 1,
  submittedAt: null,
  approvedAt: null,
  publishedAt: null,
  publicationState: null,
  publicationCycle: 0,
  publicationAttempts: 0,
  publicationLastErrorClass: null,
  reconcileDueAt: null,
  createdAt: NOW,
  updatedAt: NOW,
}

const clearScope = async () => {
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM replies WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  clearEventSchemas()
  registerAllEventSchemas()
  await clearScope()
  await deleteTestOrganizations(pool, [ORG])
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Reply Submitter Org', 'reply-submitter-org', NOW())`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Reply Submitter Hotel', 'reply-submitter-hotel', 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY, ORG],
  )
})

beforeEach(async () => {
  await clearScope()
  await createReviewRepository(getDb(), () => NOW).upsert(review)
})

afterAll(async () => {
  clearEventSchemas()
  await clearScope()
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
  await pool.end()
})

describe.sequential('the submitter of a reply (integration)', () => {
  it('is stored by the submit write beside the creator', async () => {
    const db = getDb()
    const replyRepo = createReplyRepository(db, () => NOW)
    await replyRepo.upsert(draft)

    await createAtomicReplyCommandStore(
      db,
      () => NOW,
      async () => true,
    ).submitReply(
      draft,
      { status: 'pending_approval', submittedAt: NOW, submittedBy: SUBMITTER },
      reviewReplySubmitted({
        replyId: REPLY,
        reviewId: REVIEW,
        propertyId: PROPERTY,
        organizationId: ORG,
        userId: SUBMITTER,
        occurredAt: NOW,
      }),
      NOW,
    )

    const stored = await replyRepo.findById(REPLY, ORG)
    expect(stored).toMatchObject({ createdBy: CREATOR, submittedBy: SUBMITTER })
    expect(replyAuthor(stored!)).toBe(SUBMITTER)
  })

  it('reads a reply never submitted as addressed to its creator', async () => {
    const replyRepo = createReplyRepository(getDb(), () => NOW)
    await replyRepo.upsert(draft)

    const stored = await replyRepo.findById(REPLY, ORG)
    expect(stored?.submittedBy).toBeNull()
    expect(replyAuthor(stored!)).toBe(CREATOR)
  })
})
