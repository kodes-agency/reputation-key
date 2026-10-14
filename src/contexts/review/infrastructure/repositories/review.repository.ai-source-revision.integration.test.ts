// Review context — what readForAi serves for a row stored before the source
// text rules gained revision 2 (`AI_SOURCE_TEXT_REVISION`). Real PostgreSQL.

import { createHash } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { canonicalizeRawAiReviewSourcePreviousRevision } from '#/shared/ai-review-source-contract'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { computeAiReviewSourceProvenance } from '../../application/ai-review-source'
import type { AiReviewSourceRequest } from '../../application/ports/ai-review-source.port'
import type { Review } from '../../domain/types'
import { createReviewRepository } from './review.repository'

const ORG = organizationId('org-ai-source-rev-aaaa-1111111111111111')
const PROPERTY = propertyId('72a00000-0000-4000-8000-000000000001')
const REVIEW = reviewId('72a00000-0000-4000-8000-0000000000a1')
const REVIEWED_AT = new Date('2026-09-20T12:00:00Z')
const TEXT = 'Room was clean.\nStaff were kind.\n\nBreakfast could be better.'
const READ: AiReviewSourceRequest = {
  organizationId: ORG,
  propertyId: PROPERTY,
  reviewId: REVIEW,
  expected: { kind: 'analysis', sourceEpoch: 0, sourceRevision: 1, analysisSequence: 1 },
}

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 3 })
})

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  const slug = `t-${ORG.replace(/-/g, '').slice(-12)}`
  const stale = await pool.query<{ id: string }>(
    'SELECT id FROM organization WHERE slug = $1 AND id <> $2',
    [slug, ORG],
  )
  await deleteTestOrganizations(
    pool,
    stale.rows.map(({ id }) => id),
  )
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name`,
    [ORG, 'AI source revision org', slug],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'AI source revision property', 'ai-source-revision', 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY, ORG],
  )
})

function storedUnderRevisionOne() {
  const canonical = canonicalizeRawAiReviewSourcePreviousRevision({
    text: TEXT,
    rating: 4,
    languageCode: 'en',
    reviewedAtEpochMillis: REVIEWED_AT.getTime(),
    reviewerDisplayName: null,
  })
  return {
    aiSourceByteLength: canonical.bytes.byteLength,
    aiSourceDigest: createHash('sha256')
      .update('ai-source-v1\0', 'utf8')
      .update(canonical.bytes)
      .digest('hex'),
  }
}

function storedUnderCurrentRules() {
  const provenance = computeAiReviewSourceProvenance({
    text: TEXT,
    rating: 4,
    languageCode: 'en',
    reviewedAtEpochMillis: REVIEWED_AT.getTime(),
    reviewerDisplayName: null,
  })
  return { aiSourceByteLength: provenance.byteLength, aiSourceDigest: provenance.digest }
}

async function store(provenance: Pick<Review, 'aiSourceByteLength' | 'aiSourceDigest'>) {
  const now = new Date()
  const repo = createReviewRepository(getDb(), () => now)
  await repo.upsert({
    id: REVIEW,
    organizationId: ORG,
    propertyId: PROPERTY,
    platform: 'google',
    externalId: 'ext-ai-source-revision',
    externalLocationId: 'locations/ai-source-revision',
    googleConnectionId: null,
    reviewerName: null,
    reviewerProfilePhotoUrl: null,
    rating: 4,
    text: TEXT,
    translatedText: null,
    languageCode: 'en',
    reviewedAt: REVIEWED_AT,
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: REVIEWED_AT,
    sourceUpdatedAt: null,
    firstFetchedAt: now,
    lastFetchedAt: now,
    contentExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    contentHash: 'a'.repeat(64),
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 1,
    ...provenance,
  })
  return repo
}

describe.sequential('reviewRepository.readForAi under the source text revisions', () => {
  it('serves a row stored under the current rules with its line breaks as spaces', async () => {
    const repo = await store(storedUnderCurrentRules())
    const result = await repo.readForAi(READ)
    expect(result).toMatchObject({
      status: 'available',
      observation: {
        text: 'Room was clean. Staff were kind. Breakfast could be better.',
      },
    })
  })

  it('serves a row stored under revision 1 as that revision, so its stored digest still holds', async () => {
    const repo = await store(storedUnderRevisionOne())
    const result = await repo.readForAi(READ)
    expect(result).toMatchObject({
      status: 'available',
      observation: {
        text: 'Room was clean.Staff were kind.Breakfast could be better.',
      },
    })
  })

  it('refuses a row whose stored digest neither revision computes', async () => {
    const repo = await store({
      ...storedUnderCurrentRules(),
      aiSourceDigest: 'f'.repeat(64),
    })
    await expect(repo.readForAi(READ)).resolves.toEqual({ status: 'policy_unavailable' })
  })
})
