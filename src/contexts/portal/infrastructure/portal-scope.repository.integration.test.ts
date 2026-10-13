// Portal scope lookups against real PostgreSQL. Every Portal server function
// resolves the entity it was handed through one of these before it asks the
// policy, so what they answer for an id that cannot name a row is what a
// caller sees: "not found", never a refused `uuid` cast.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { buildTestPortal } from '#/shared/testing/fixtures'
import {
  organizationId,
  portalGroupId,
  portalId,
  portalLinkCategoryId,
  portalLinkId,
  propertyId,
} from '#/shared/domain/ids'
import { createPortalScopeRepository } from './repositories/portal-scope.repository'
import { createPostgresPortalFixtureStore } from './testing/postgres-portal-fixture-store'

const db = getDb()
const ORG = organizationId('org-portal-scope-lookup')
const PROPERTY = propertyId('5c09e000-0000-4000-8000-000000000001')
// The fixtures' own id shape: canonical text, but no RFC version nibble.
const PORTAL = portalId('5c09e000-0000-0000-0000-0000000000a1')
const UNKNOWN = '5c09e000-0000-4000-8000-0000000000ff'

const MALFORMED_IDS = [
  'x',
  'portal-p2',
  // One character short of a UUID.
  '5c09e000-0000-4000-8000-0000000000f',
  "5c09e000-0000-4000-8000-0000000000ff' OR '1'='1",
] as const

async function clearFixtures(): Promise<void> {
  await db.execute(sql`DELETE FROM portals WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await deleteTestOrganizations(db, [ORG])
}

beforeAll(async () => {
  await clearFixtures()
  await db.execute(
    sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${ORG}, 'Portal Scope Org', ${ORG}, now())`,
  )
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone)
    VALUES (${PROPERTY}, ${ORG}, 'portal-scope-prop', 'portal-scope-prop', 'UTC')
  `)
  await createPostgresPortalFixtureStore(db).insert(
    ORG,
    buildTestPortal({
      id: PORTAL,
      organizationId: ORG,
      propertyId: PROPERTY,
      slug: 'portal-scope-lookup',
    }),
  )
})

afterAll(clearFixtures)

describe('Portal scope lookups (PostgreSQL)', () => {
  const scopes = createPortalScopeRepository(db)

  it('resolves a Portal that exists to its Organization and Property', async () => {
    await expect(scopes.resolvePortal(PORTAL)).resolves.toEqual({
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
    })
  })

  it('answers null for a well-formed id that names no row', async () => {
    await expect(scopes.resolvePortal(portalId(UNKNOWN))).resolves.toBeNull()
    await expect(scopes.resolveGroup(portalGroupId(UNKNOWN))).resolves.toBeNull()
    await expect(
      scopes.resolveCategory(portalLinkCategoryId(UNKNOWN)),
    ).resolves.toBeNull()
    await expect(scopes.resolveLink(portalLinkId(UNKNOWN))).resolves.toBeNull()
  })

  it.each(MALFORMED_IDS)(
    'answers null for %j, which is not a UUID, on every lookup',
    async (id) => {
      await expect(scopes.resolvePortal(portalId(id))).resolves.toBeNull()
      await expect(scopes.resolveGroup(portalGroupId(id))).resolves.toBeNull()
      await expect(scopes.resolveCategory(portalLinkCategoryId(id))).resolves.toBeNull()
      await expect(scopes.resolveLink(portalLinkId(id))).resolves.toBeNull()
    },
  )
})
