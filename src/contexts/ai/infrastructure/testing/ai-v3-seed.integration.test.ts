// The v3 seed in `adopt` mode (PostgreSQL), which an end-to-end stack uses: the
// Organization and the Property are the caller's, the seed adds its AI rows to them and
// takes only those away, and the caller can then remove the Property the way its own
// cleanup does, with nothing of the seed left to refuse it. Every value is invented.
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { getDb, type Database } from '#/shared/db'
import { deleteTestOrganizationsWithExecutor } from '#/shared/db/testing/test-organization-cleanup'
import { createV3Seed, mentionOf, seededReviewId } from './ai-v3-seed'

const IDS = {
  organizationId: 'ai-v3-seed-adopt-test-org',
  propertyId: '79000000-0000-4000-8000-000000000001',
  idPrefix: '79000000',
} as const

const MINE = `organization_id = '${IDS.organizationId}' AND property_id = '${IDS.propertyId}'`

const NOON = (day: number) => new Date(Date.UTC(2026, 9, day, 16, 0, 0))

async function count(db: Database, table: string, where: string): Promise<number> {
  const result = await db.execute<{ n: number }>(
    sql.raw(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`),
  )
  return Number(result.rows[0]?.n ?? 0)
}

describe.sequential(
  'the v3 seed adopting an Organization and a Property (PostgreSQL)',
  () => {
    const db: Database = getDb()
    const seed = createV3Seed(db, IDS, {
      adopt: true,
      externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    })

    async function removeProperty(): Promise<void> {
      await db.execute(
        sql`DELETE FROM properties WHERE organization_id = ${IDS.organizationId} AND id = ${IDS.propertyId}`,
      )
    }

    /** A Property in the shape an end-to-end spec's `seedProperty` writes. */
    async function makeProperty(): Promise<void> {
      await removeProperty()
      await db.execute(sql`
      INSERT INTO properties
        (id, organization_id, name, slug, timezone, country_code, country_source,
         lifecycle_state, source_epoch)
      VALUES (${IDS.propertyId}, ${IDS.organizationId}, 'Adopted property',
              'ai-v3-seed-adopt-test', 'America/New_York', 'US', 'manual', 'active', 0)
    `)
    }

    beforeAll(async () => {
      await removeProperty()
      await deleteTestOrganizationsWithExecutor(db, [IDS.organizationId])
      await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${IDS.organizationId}, 'Adopted', ${IDS.organizationId}, now())
    `)
    })

    afterAll(async () => {
      await removeProperty()
      await deleteTestOrganizationsWithExecutor(db, [IDS.organizationId])
    })

    it('adds AI rows to the Property it was given and, removing them, leaves the Organization and the Property standing', async () => {
      await makeProperty()
      await seed.setUp()
      await seed.addReview({
        index: 1,
        rating: 2,
        reviewedAt: NOON(10),
        sentiment: 'negative',
        mentions: [mentionOf({ topic: 'facilities_equipment', polarity: 'negative' })],
      })
      await seed.seal()

      expect(
        await count(db, 'reviews', `${MINE} AND id = '${seededReviewId(IDS, 1)}'`),
      ).toBe(1)
      expect(await count(db, 'ai_review_analyses', MINE)).toBeGreaterThan(0)
      expect(await count(db, 'merchant_ai_enablement', MINE)).toBe(1)

      await seed.tearDown()

      expect(await count(db, 'reviews', MINE)).toBe(0)
      expect(await count(db, 'ai_operations', MINE)).toBe(0)
      expect(await count(db, 'ai_review_analyses', MINE)).toBe(0)
      expect(await count(db, 'organization', `id = '${IDS.organizationId}'`)).toBe(1)
      expect(await count(db, 'properties', `id = '${IDS.propertyId}'`)).toBe(1)
    })

    it('leaves a Property its caller can delete, taking the rest of the seed with it', async () => {
      // The previous test's authorization, profile and head are still on the Property.
      expect(await count(db, 'merchant_ai_enablement', MINE)).toBe(1)

      await removeProperty()

      expect(await count(db, 'properties', `id = '${IDS.propertyId}'`)).toBe(0)
      expect(await count(db, 'merchant_ai_enablement', MINE)).toBe(0)
      expect(await count(db, 'merchant_ai_consent_evidence', MINE)).toBe(0)
      expect(await count(db, 'ai_property_processing_profiles', MINE)).toBe(0)
      expect(await count(db, 'review_ai_analysis_heads', MINE)).toBe(0)
    })
  },
)
