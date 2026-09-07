import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'

const db = getDb()
const orgId = 'org-guest-tenant-invariant'
const propertyOne = '00000000-0000-4000-8000-000000000101'
const propertyTwo = '00000000-0000-4000-8000-000000000102'
const portalOne = '00000000-0000-4000-8000-000000000103'
const responseOne = '00000000-0000-4000-8000-000000000104'

beforeAll(async () => {
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${orgId}, 'Guest Tenant Invariant', ${orgId}, now())
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone)
    VALUES
      (${propertyOne}, ${orgId}, 'Property One', 'guest-property-one', 'UTC'),
      (${propertyTwo}, ${orgId}, 'Property Two', 'guest-property-two', 'UTC')
  `)
  await db.execute(sql`
    INSERT INTO portals (
      id, organization_id, property_id, entity_type, entity_id, name, slug,
      publication_state
    ) VALUES (
      ${portalOne}, ${orgId}, ${propertyOne}, 'property', ${propertyOne},
      'Guest Portal', 'guest-portal', 'published'
    )
  `)
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM guest_responses WHERE organization_id = ${orgId}`)
  await db.execute(sql`DELETE FROM portals WHERE organization_id = ${orgId}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${orgId}`)
  await deleteTestOrganizations(db, [orgId])
})

describe('guest tenant/property database invariants', () => {
  it('rejects a response whose property does not own the portal', async () => {
    await expect(
      db.execute(sql`
        INSERT INTO guest_responses (
          id, organization_id, property_id, portal_id, status,
          response_consent, retention_deadline
        ) VALUES (
          ${responseOne}, ${orgId}, ${propertyTwo}, ${portalOne},
          'submitted', true, now() + interval '24 months'
        )
      `),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof Error &&
        error.cause instanceof Error &&
        error.cause.message.includes('guest_responses_portal_property_tenant_fk'),
    )
  })
})
