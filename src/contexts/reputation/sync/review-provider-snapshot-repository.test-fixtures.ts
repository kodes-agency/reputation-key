import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll } from 'vitest'
import { replyScopeEffects } from '#/contexts/reputation/public-api'
import { getDb } from '#/shared/db'
import { properties, reviewProviderSnapshotRuns } from '#/shared/db/schema'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { deleteOrganizationReplies } from '#/shared/db/testing/test-organization-cleanup'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createReviewProviderSnapshotRepository } from './review-provider-snapshot-repository.server'

export const ORGANIZATION_ID = 'review-snapshot-repo-test-org'
export const PROPERTY_ID = '72000000-0000-4000-8000-000000000001'
export const RUN_ID = '72000000-0000-4000-8000-000000000002'
export const OTHER_RUN_ID = '72000000-0000-4000-8000-000000000003'
export const REVIEW_ID = '72000000-0000-4000-8000-000000000004'
export const REPLY_ID = '72000000-0000-4000-8000-000000000005'
export const LIFECYCLE_RUN_ID = '72000000-0000-4000-8000-000000000006'
export const EXPIRING_REVIEW_ID = '72000000-0000-4000-8000-000000000007'
export const EXPIRING_REPLY_ID = '72000000-0000-4000-8000-000000000008'
export const TEST_KEY_VERSION = 'safe03-test-v1'
export const STARTED_AT = new Date('2026-08-19T10:00:00.000Z')
export const EXPIRES_AT = new Date('2026-08-19T22:00:00.000Z')
export const PROVIDER_DELETE_GATE_CLASS = 27_127
export const PROVIDER_DELETE_GATE_OBJECT = 55

export { waitForDatabaseCondition } from '#/shared/db/testing/lock-gate'

/** Registers the Organization and Property every snapshot repository suite
 * runs against, and removes them (and everything hung off them) afterwards. */
export function useSnapshotRepositoryDb() {
  const db = getDb()
  const repository = createReviewProviderSnapshotRepository(
    db,
    () => RUN_ID,
    replyScopeEffects,
  )

  const clear = async () => {
    await db.execute(sql`DELETE FROM review_sync_runs WHERE property_id = ${PROPERTY_ID}`)

    await db.execute(sql`
      DROP TRIGGER IF EXISTS review_provider_delete_lock_order_gate ON reviews;
      DROP FUNCTION IF EXISTS review_provider_delete_lock_order_gate();
    `)
    await db.execute(
      sql`DELETE FROM outbox_events WHERE organization_id = ${ORGANIZATION_ID}`,
    )
    await deleteOrganizationReplies(db, ORGANIZATION_ID)
    await db.execute(sql`DELETE FROM reviews WHERE organization_id = ${ORGANIZATION_ID}`)
    await db
      .delete(reviewProviderSnapshotRuns)
      .where(eq(reviewProviderSnapshotRuns.propertyId, PROPERTY_ID))
    await db.delete(properties).where(eq(properties.id, PROPERTY_ID))
    await db.execute(
      sql`DELETE FROM review_provider_subject_hmac_key_versions WHERE key_version = ${TEST_KEY_VERSION}`,
    )
    await db.execute(sql`DELETE FROM retention_runs WHERE subject = 'reviews.purge'`)
    await deleteTestOrganizations(db, [ORGANIZATION_ID])
  }

  beforeAll(async () => {
    await clear()
    clearEventSchemas()
    registerAllEventSchemas()
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORGANIZATION_ID}, 'Snapshot repo test', ${ORGANIZATION_ID}, ${STARTED_AT})
    `)
    await db.insert(properties).values({
      id: PROPERTY_ID,
      organizationId: ORGANIZATION_ID,
      name: 'Snapshot repo property',
      slug: 'snapshot-repo-property',
      timezone: 'Europe/Sofia',
      countryCode: 'BG',
      profileVersion: 1,
      // The domain default: a property that has never been edited. The AI plane
      // used to reject this value outright (see drizzle/0060).
      sourceEpoch: 0,
    })
  })

  afterAll(async () => {
    await clear()
    clearEventSchemas()
  })

  return { db, repository, clear }
}
