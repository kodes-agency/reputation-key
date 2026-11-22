import { Pool } from 'pg'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/shared/testing/google-provider-identifiers-v1'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import type { Review } from '../domain/review-types'

export const ORG_A = organizationId('org-rev-test-aaaa-1111111111111111')
export const ORG_B = organizationId('org-rev-test-bbbb-2222222222222222')
export const PROP_A = propertyId('71a00000-0000-4000-8000-000000000001')
export const PROP_B = propertyId('71b00000-0000-4000-8000-000000000002')

export async function truncateReviews(pool: Pool) {
  for (const table of ['replies', 'reviews'])
    await pool.query(`DELETE FROM ${table} WHERE organization_id IN ($1, $2)`, [
      ORG_A,
      ORG_B,
    ])
}

export async function seedOrgs(pool: Pool, ids: string[]) {
  // Clean up stale rows that hold our target slugs (from previous test runs with different IDs)
  const slugs = ids.map((id) => 't-' + id.replace(/-/g, '').slice(-12))
  const conflictingOrganizations = await pool.query<{ id: string }>(
    `SELECT id FROM organization WHERE slug = ANY($1) AND NOT (id = ANY($2))`,
    [slugs, ids],
  )
  await deleteTestOrganizations(
    pool,
    conflictingOrganizations.rows.map(({ id }) => id),
  )
  for (const id of ids) {
    const slug = 't-' + id.replace(/-/g, '').slice(-12)
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name`,
      [id, `Test Org ${slug}`, slug],
    )
  }
}

export async function seedProperties(pool: Pool) {
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROP_A, ORG_A, 'Test Property A', 'test-prop-a', 'UTC'],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROP_B, ORG_B, 'Test Property B', 'test-prop-b', 'UTC'],
  )
}

export function buildTestReview(
  overrides: Partial<Omit<Review, 'id'>> & { id?: string } = {},
): Review {
  const idStr = overrides.id ?? '1a000000-0000-0000-0000-000000000001'
  const now = new Date('2025-06-01T12:00:00Z')
  const reviewedAt = new Date('2025-05-27T12:00:00Z')
  const { id: _ignored, ...rest } = overrides
  return {
    id: reviewId(idStr),
    organizationId: ORG_A,
    propertyId: PROP_A,
    platform: 'google',
    externalId: 'ext-001',
    externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    googleConnectionId: null,
    reviewerName: 'Jane Doe',
    reviewerProfilePhotoUrl: null,
    rating: 5,
    text: 'Great place!',
    languageCode: 'en',
    reviewedAt,
    expiresAt: new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000),
    sentimentLabel: null,
    sentimentScore: null,
    sourceEpoch: 0,
    sourceRevision: 0,
    analysisSequence: 0,
    aiSourceByteLength: 1,
    aiSourceDigest: '0'.repeat(64),
    firstFetchedAt: now,
    lastFetchedAt: now,
    contentExpiresAt: new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
    ...rest,
  } as Review
}
